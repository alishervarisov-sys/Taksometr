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
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.tasks.await
import java.util.*
import javax.inject.Inject
import javax.inject.Singleton

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
            val existingItems = itemDao.getItemsByChainIdSync(chainId)
            val nextOrder = (existingItems.maxOfOrNull { it.sequenceOrder } ?: 0) + 1
            
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
            if (items.isEmpty()) {
                return Resource.Error("Добавьте хотя бы один заказ")
            }
            
            // Вызываем Cloud Function для создания цепочки на сервере
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
            
            // Обновляем локально
            val updatedChain = chainEntity.copy(
                status = DeliveryChainStatus.IN_PROGRESS.name,
                startedAt = System.currentTimeMillis()
            )
            chainDao.update(updatedChain)
            
            // Запускаем первую доставку
            val firstItem = items.minByOrNull { it.sequenceOrder }
            if (firstItem != null) {
                itemDao.update(firstItem.copy(
                    status = DeliveryStatus.IN_PROGRESS.name,
                    startTime = System.currentTimeMillis()
                ))
            }
            
            Resource.Success(updatedChain.toDeliveryChain())
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
            val currentItem = items.firstOrNull { it.status == DeliveryStatus.IN_PROGRESS.name }
                ?: return Resource.Error("Нет активной доставки")
            
            // Получаем маршрут текущей доставки
            val points = currentItem.deliveryId?.let { 
                routePointDao.getPointsByDeliveryIdSync(it) 
            } ?: emptyList()
            
            val routeData = points.map { point ->
                hashMapOf(
                    "latitude" to point.latitude,
                    "longitude" to point.longitude,
                    "timestamp" to point.timestamp,
                    "accuracy" to point.accuracy
                )
            }
            
            // Вызываем Cloud Function для завершения текущей доставки
            val data = hashMapOf(
                "chainId" to chainId,
                "itemId" to currentItem.id,
                "deliveryId" to (currentItem.deliveryId ?: ""),
                "route" to routeData,
                "waitingMinutes" to waitingMinutes,
                "endTime" to System.currentTimeMillis()
            )
            
            val result = functions.getHttpsCallable("completeChainDelivery").call(data).await()
            
            @Suppress("UNCHECKED_CAST")
            val responseData = result.data as Map<String, Any>
            val cost = (responseData["cost"] as? Number)?.toDouble() ?: 0.0
            val distance = (responseData["distanceMeters"] as? Number)?.toDouble() ?: 0.0
            
            // Обновляем текущую доставку
            itemDao.update(currentItem.copy(
                status = DeliveryStatus.COMPLETED.name,
                endTime = System.currentTimeMillis(),
                cost = cost,
                distanceMeters = distance
            ))
            
            // Проверяем, есть ли следующая доставка
            val nextItem = items
                .filter { it.status == DeliveryStatus.PENDING.name }
                .minByOrNull { it.sequenceOrder }
            
            if (nextItem != null) {
                // Запускаем следующую доставку
                itemDao.update(nextItem.copy(
                    status = DeliveryStatus.IN_PROGRESS.name,
                    startTime = System.currentTimeMillis()
                ))
            } else {
                // Все доставки завершены
                chainDao.update(chainEntity.copy(
                    status = DeliveryChainStatus.COMPLETED.name,
                    completedAt = System.currentTimeMillis()
                ))
            }
            
            val updatedChain = chainDao.getById(chainId)
            Resource.Success(updatedChain?.toDeliveryChain() ?: chainEntity.toDeliveryChain())
        } catch (e: Exception) {
            Resource.Error("Ошибка завершения доставки: ${e.localizedMessage}")
        }
    }

    override suspend fun cancelChain(chainId: String): Resource<Unit> {
        return try {
            val chainEntity = chainDao.getById(chainId)
                ?: return Resource.Error("Цепочка не найдена")
            
            // Отменяем на сервере
            val data = hashMapOf("chainId" to chainId, "courierId" to userId)
            functions.getHttpsCallable("cancelDeliveryChain").call(data).await()
            
            // Обновляем локально
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
            val chainEntity = chainDao.getById(chainId)
                ?: return Resource.Error("Цепочка не найдена")
            
            val items = itemDao.getItemsByChainIdSync(chainId)
            val chain = chainEntity.toDeliveryChain().copy(
                items = items.map { it.toChainDeliveryItem() }
            )
            
            Resource.Success(chain)
        } catch (e: Exception) {
            Resource.Error("Ошибка загрузки цепочки: ${e.localizedMessage}")
        }
    }

    override fun observeChain(chainId: String): Flow<DeliveryChain?> {
        return combine(
            chainDao.getByIdFlow(chainId),
            itemDao.getItemsByChainId(chainId)
        ) { chain, items ->
            chain?.toDeliveryChain()?.copy(
                items = items.map { it.toChainDeliveryItem() }
            )
        }
    }

    override fun getActiveChain(courierId: String): Flow<DeliveryChain?> {
        return combine(
            chainDao.getActiveChain(courierId),
            chainDao.getActiveChain(courierId)
        ) { chain, _ ->
            if (chain != null) {
                val items = itemDao.getItemsByChainIdSync(chain.id)
                chain.toDeliveryChain().copy(
                    items = items.map { it.toChainDeliveryItem() }
                )
            } else {
                null
            }
        }
    }

    override fun getChainsByCourier(courierId: String): Flow<List<DeliveryChain>> {
        return chainDao.getChainsByCourier(courierId).combine(
            chainDao.getChainsByCourier(courierId)
        ) { chains, _ ->
            chains.map { chain ->
                val items = itemDao.getItemsByChainIdSync(chain.id)
                chain.toDeliveryChain().copy(
                    items = items.map { it.toChainDeliveryItem() }
                )
            }
        }
    }

    override fun getDraftChains(courierId: String): Flow<List<DeliveryChain>> {
        return chainDao.getDraftChains(courierId).combine(
            chainDao.getDraftChains(courierId)
        ) { chains, _ ->
            chains.map { chain ->
                val items = itemDao.getItemsByChainIdSync(chain.id)
                chain.toDeliveryChain().copy(
                    items = items.map { it.toChainDeliveryItem() }
                )
            }
        }
    }
}
