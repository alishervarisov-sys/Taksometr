package com.zaki.taksometr.data.repository

import android.content.SharedPreferences
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.functions.FirebaseFunctions
import com.zaki.taksometr.data.local.dao.ChainDeliveryItemDao
import com.zaki.taksometr.data.local.dao.DeliveryChainDao
import com.zaki.taksometr.data.local.dao.RoutePointDao
import com.zaki.taksometr.data.local.entity.ChainDeliveryItemEntity
import com.zaki.taksometr.data.local.entity.DeliveryChainEntity
import com.zaki.taksometr.domain.model.ChainDeliveryItem
import com.zaki.taksometr.domain.model.DeliveryChain
import com.zaki.taksometr.domain.model.DeliveryChainStatus
import com.zaki.taksometr.domain.model.DeliveryStatus
import com.zaki.taksometr.domain.repository.DeliveryChainRepository
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.Resource
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await
import java.util.*
import javax.inject.Inject
import javax.inject.Singleton

@OptIn(ExperimentalCoroutinesApi::class)
@Singleton
class DeliveryChainRepositoryImpl @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val functions: FirebaseFunctions,
    private val chainDao: DeliveryChainDao,
    private val itemDao: ChainDeliveryItemDao,
    private val routePointDao: RoutePointDao,
    private val prefs: SharedPreferences
) : DeliveryChainRepository {

    private val userId: String
        get() = prefs.getString(Constants.PREF_USER_ID, "") ?: ""

    private val userName: String
        get() = prefs.getString(Constants.PREF_USER_NAME, "") ?: ""

    override suspend fun createChain(): Resource<DeliveryChain> {
        return try {
            val chain = DeliveryChain(
                id = UUID.randomUUID().toString(),
                courierId = userId,
                courierName = userName,
                status = DeliveryChainStatus.DRAFT,
                createdAt = System.currentTimeMillis()
            )
            chainDao.insert(DeliveryChainEntity.fromDeliveryChain(chain))
            Resource.Success(chain)
        } catch (e: Exception) {
            Resource.Error("Ошибка создания цепочки: ${e.localizedMessage}")
        }
    }

    override suspend fun addItemToChain(
        chainId: String,
        clientPhone: String,
        orderNumber: String,
        deliveryType: String
    ): Resource<ChainDeliveryItem> {
        return try {
            val existing = itemDao.getItemsByChainIdSync(chainId)
            val nextOrder = (existing.maxOfOrNull { it.sequenceOrder } ?: 0) + 1
            val item = ChainDeliveryItem(
                id = UUID.randomUUID().toString(),
                chainId = chainId,
                clientPhone = clientPhone,
                orderNumber = orderNumber,
                sequenceOrder = nextOrder,
                status = DeliveryStatus.PENDING,
                deliveryType = deliveryType,
                createdAt = System.currentTimeMillis()
            )
            itemDao.insert(ChainDeliveryItemEntity.fromChainDeliveryItem(item))
            Resource.Success(item)
        } catch (e: Exception) {
            Resource.Error("Ошибка добавления заказа: ${e.localizedMessage}")
        }
    }

    override suspend fun removeItemFromChain(itemId: String): Resource<Unit> {
        return try {
            val item = itemDao.getById(itemId)
            if (item != null) {
                itemDao.delete(item)
                Resource.Success(Unit)
            } else {
                Resource.Error("Заказ не найден")
            }
        } catch (e: Exception) {
            Resource.Error("Ошибка удаления заказа: ${e.localizedMessage}")
        }
    }

    override suspend fun updateSequenceOrder(items: List<ChainDeliveryItem>): Resource<Unit> {
        return try {
            items.forEachIndexed { index, item ->
                itemDao.updateSequenceOrder(item.id, index + 1)
            }
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error("Ошибка изменения порядка: ${e.localizedMessage}")
        }
    }

    override suspend fun startChain(chainId: String): Resource<DeliveryChain> {
        return try {
            val chainEntity = chainDao.getById(chainId)
                ?: return Resource.Error("Цепочка не найдена")
            val items = itemDao.getItemsByChainIdSync(chainId)
            if (items.isEmpty()) return Resource.Error("Добавьте хотя бы один заказ")

            val data = hashMapOf(
                "chainId" to chainId,
                "courierId" to userId,
                "items" to items.map { item ->
                    hashMapOf(
                        "id" to item.id,
                        "clientPhone" to item.clientPhone,
                        "orderNumber" to item.orderNumber,
                        "sequenceOrder" to item.sequenceOrder,
                        "deliveryType" to item.deliveryType
                    )
                }
            )
            functions.getHttpsCallable("startDeliveryChain").call(data).await()

            val updated = chainEntity.copy(
                status = DeliveryChainStatus.IN_PROGRESS.name,
                startedAt = System.currentTimeMillis()
            )
            chainDao.update(updated)

            val first = items.minByOrNull { it.sequenceOrder }
            first?.let {
                itemDao.update(it.copy(
                    status = DeliveryStatus.IN_PROGRESS.name,
                    startTime = System.currentTimeMillis()
                ))
            }
            Resource.Success(updated.toDeliveryChain())
        } catch (e: Exception) {
            Resource.Error("Ошибка запуска цепочки: ${e.localizedMessage}")
        }
    }

    override suspend fun completeCurrentAndMoveNext(
        chainId: String,
        waitingMinutes: Double
    ): Resource<DeliveryChain> {
        return try {
            val chainEntity = chainDao.getById(chainId)
                ?: return Resource.Error("Цепочка не найдена")
            val items = itemDao.getItemsByChainIdSync(chainId)
            val current = items.firstOrNull { it.status == DeliveryStatus.IN_PROGRESS.name }
                ?: return Resource.Error("Нет активной доставки")

            val points = current.deliveryId?.let {
                routePointDao.getPointsByDeliveryIdSync(it)
            } ?: emptyList()

            val routeData = points.map { p ->
                hashMapOf(
                    "latitude" to p.latitude,
                    "longitude" to p.longitude,
                    "timestamp" to p.timestamp,
                    "accuracy" to p.accuracy
                )
            }

            val data = hashMapOf(
                "chainId" to chainId,
                "itemId" to current.id,
                "route" to routeData,
                "waitingMinutes" to waitingMinutes,
                "endTime" to System.currentTimeMillis()
            )
            val result = functions.getHttpsCallable("completeChainDelivery").call(data).await()

            @Suppress("UNCHECKED_CAST")
            val resp = result.data as Map<String, Any>
            val cost = (resp["cost"] as? Number)?.toDouble() ?: 0.0
            val dist = (resp["distanceMeters"] as? Number)?.toDouble() ?: 0.0

            itemDao.update(current.copy(
                status = DeliveryStatus.COMPLETED.name,
                endTime = System.currentTimeMillis(),
                cost = cost,
                distanceMeters = dist
            ))

            val next = items
                .filter { it.status == DeliveryStatus.PENDING.name }
                .minByOrNull { it.sequenceOrder }

            if (next != null) {
                itemDao.update(next.copy(
                    status = DeliveryStatus.IN_PROGRESS.name,
                    startTime = System.currentTimeMillis()
                ))
            } else {
                chainDao.update(chainEntity.copy(
                    status = DeliveryChainStatus.COMPLETED.name,
                    completedAt = System.currentTimeMillis()
                ))
            }

            val updated = chainDao.getById(chainId)
            Resource.Success(updated?.toDeliveryChain() ?: chainEntity.toDeliveryChain())
        } catch (e: Exception) {
            Resource.Error("Ошибка завершения доставки: ${e.localizedMessage}")
        }
    }

    override suspend fun cancelChain(chainId: String): Resource<Unit> {
        return try {
            val chainEntity = chainDao.getById(chainId)
                ?: return Resource.Error("Цепочка не найдена")
            val data = hashMapOf("chainId" to chainId, "courierId" to userId)
            functions.getHttpsCallable("cancelDeliveryChain").call(data).await()
            chainDao.update(chainEntity.copy(
                status = DeliveryChainStatus.CANCELLED.name,
                completedAt = System.currentTimeMillis()
            ))
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error("Ошибка отмены цепочки: ${e.localizedMessage}")
        }
    }

    override suspend fun getChainById(chainId: String): Resource<DeliveryChain> {
        return try {
            val entity = chainDao.getById(chainId)
                ?: return Resource.Error("Цепочка не найдена")
            val items = itemDao.getItemsByChainIdSync(chainId)
            Resource.Success(entity.toDeliveryChain().copy(
                items = items.map { it.toChainDeliveryItem() }
            ))
        } catch (e: Exception) {
            Resource.Error("Ошибка загрузки цепочки: ${e.localizedMessage}")
        }
    }

    override fun observeChain(chainId: String): Flow<DeliveryChain?> {
        return combine(
            chainDao.getByIdFlow(chainId),
            itemDao.getItemsByChainId(chainId)
        ) { chain, items ->
            chain?.toDeliveryChain()?.copy(items = items.map { it.toChainDeliveryItem() })
        }
    }

    override fun getActiveChain(courierId: String): Flow<DeliveryChain?> {
        return chainDao.getActiveChain(courierId).flatMapLatest { chain ->
            if (chain == null) flowOf(null)
            else itemDao.getItemsByChainId(chain.id).map { items ->
                chain.toDeliveryChain().copy(items = items.map { it.toChainDeliveryItem() })
            }
        }
    }

    override fun getChainsByCourier(courierId: String): Flow<List<DeliveryChain>> {
        return chainDao.getChainsByCourier(courierId).flatMapLatest { chains ->
            if (chains.isEmpty()) flowOf(emptyList())
            else flowOf(chains.map { chain ->
                val items = itemDao.getItemsByChainIdSync(chain.id)
                chain.toDeliveryChain().copy(items = items.map { it.toChainDeliveryItem() })
            })
        }
    }

    override fun getDraftChains(courierId: String): Flow<List<DeliveryChain>> {
        return chainDao.getDraftChains(courierId).flatMapLatest { chains ->
            if (chains.isEmpty()) flowOf(emptyList())
            else flowOf(chains.map { chain ->
                val items = itemDao.getItemsByChainIdSync(chain.id)
                chain.toDeliveryChain().copy(items = items.map { it.toChainDeliveryItem() })
            })
        }
    }
}
