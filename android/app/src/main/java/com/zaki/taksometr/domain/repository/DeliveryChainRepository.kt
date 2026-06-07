package com.zaki.taksometr.domain.repository

import com.zaki.taksometr.domain.model.ChainDeliveryItem
import com.zaki.taksometr.domain.model.DeliveryChain
import com.zaki.taksometr.util.Resource
import kotlinx.coroutines.flow.Flow

interface DeliveryChainRepository {
    
    // Создать новую цепочку
    suspend fun createChain(): Resource<DeliveryChain>
    
    // Добавить доставку в цепочку
    suspend fun addItemToChain(
        chainId: String,
        clientPhone: String,
        orderNumber: String,
        deliveryType: String = "default"
    ): Resource<ChainDeliveryItem>
    
    // Удалить доставку из цепочки
    suspend fun removeItemFromChain(itemId: String): Resource<Unit>
    
    // Изменить порядок доставок
    suspend fun updateSequenceOrder(items: List<ChainDeliveryItem>): Resource<Unit>
    
    // Запустить цепочку доставок
    suspend fun startChain(chainId: String): Resource<DeliveryChain>
    
    // Завершить текущую доставку в цепочке и перейти к следующей
    suspend fun completeCurrentAndMoveNext(chainId: String, waitingMinutes: Double): Resource<DeliveryChain>
    
    // Отменить всю цепочку
    suspend fun cancelChain(chainId: String): Resource<Unit>
    
    // Получить цепочку по ID
    suspend fun getChainById(chainId: String): Resource<DeliveryChain>
    
    // Наблюдать за цепочкой
    fun observeChain(chainId: String): Flow<DeliveryChain?>
    
    // Получить активную цепочку курьера
    fun getActiveChain(courierId: String): Flow<DeliveryChain?>
    
    // Получить все цепочки курьера
    fun getChainsByCourier(courierId: String): Flow<List<DeliveryChain>>
    
    // Получить черновики (незапущенные цепочки)
    fun getDraftChains(courierId: String): Flow<List<DeliveryChain>>

    // Синхронизировать активную цепочку с сервера (если есть) и сохранить локально
    suspend fun syncActiveChain(): Resource<Unit>
}
