package com.zaki.taksometr.presentation.home

import android.Manifest
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import android.provider.Settings
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.rememberMultiplePermissionsState
import com.zaki.taksometr.presentation.theme.*
import com.zaki.taksometr.service.LocationTrackingService
import com.zaki.taksometr.util.LocationUtils
import com.zaki.taksometr.util.str
import com.zaki.taksometr.util.Strings

@OptIn(ExperimentalPermissionsApi::class, ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onStartDelivery: () -> Unit,
    onHistoryClick: () -> Unit,
    onChainClick: () -> Unit,
    onLogout: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    
    // Language dialog state
    var showLanguageDialog by remember { mutableStateOf(false) }
    val prefs = remember { 
        context.getSharedPreferences(com.zaki.taksometr.util.Constants.PREFS_NAME, android.content.Context.MODE_PRIVATE) 
    }
    val currentLanguage = remember(showLanguageDialog) {
        com.zaki.taksometr.util.LocalizationManager.getCurrentLanguage(prefs)
    }

    val locationPermissions = rememberMultiplePermissionsState(
        permissions = listOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
    )

    // Check if GPS is enabled
    var isGpsEnabled by remember { mutableStateOf(isLocationEnabled(context)) }

    // Re-check GPS when app resumes (user might have enabled it in settings)
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                isGpsEnabled = isLocationEnabled(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // If permissions not granted, request them
    LaunchedEffect(Unit) {
        if (!locationPermissions.allPermissionsGranted) {
            locationPermissions.launchMultiplePermissionRequest()
        }
    }

    // BLOCK: If no permission or GPS is off — show full-screen blocker
    if (!locationPermissions.allPermissionsGranted || !isGpsEnabled) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text("ZaKi Taksometr") },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        titleContentColor = MaterialTheme.colorScheme.onPrimary
                    )
                )
            }
        ) { paddingValues ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
                    .padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Icon(
                    Icons.Default.LocationOff,
                    contentDescription = null,
                    modifier = Modifier.size(80.dp),
                    tint = AccentRed
                )
                Spacer(modifier = Modifier.height(24.dp))
                Text(
                    text = str(Strings.locationDisabled),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = str(Strings.locationDisabledMessage),
                    style = MaterialTheme.typography.bodyLarge,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                )
                Spacer(modifier = Modifier.height(32.dp))

                if (!locationPermissions.allPermissionsGranted) {
                    Button(
                        onClick = { locationPermissions.launchMultiplePermissionRequest() },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(Icons.Default.Security, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(str(Strings.allowAccess))
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                }

                if (!isGpsEnabled) {
                    Button(
                        onClick = {
                            context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = AccentGreen)
                    ) {
                        Icon(Icons.Default.GpsFixed, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(str(Strings.enableGPS))
                    }
                }
            }
        }
        return
    }

    // If user is blocked or deleted, force logout
    LaunchedEffect(state.isBlocked) {
        if (state.isBlocked) {
            onLogout()
        }
    }

    // If there's an active delivery, navigate to it
    LaunchedEffect(state.activeDelivery) {
        if (state.activeDelivery != null) {
            LocationTrackingService.startService(context)
            onStartDelivery()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "ZaKi Taksometr",
                        style = MaterialTheme.typography.titleLarge
                    )
                },
                actions = {
                    IconButton(onClick = { showLanguageDialog = true }) {
                        Icon(Icons.Outlined.Language, contentDescription = str(Strings.language))
                    }
                    IconButton(onClick = onHistoryClick) {
                        Icon(Icons.Default.History, contentDescription = str(Strings.history))
                    }
                    IconButton(onClick = {
                        viewModel.logout()
                        onLogout()
                    }) {
                        Icon(Icons.Default.Logout, contentDescription = str(Strings.logout))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = MaterialTheme.colorScheme.onPrimary,
                    actionIconContentColor = MaterialTheme.colorScheme.onPrimary
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Courier info card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(20.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Avatar
                    Box(
                        modifier = Modifier
                            .size(56.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primary),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = state.user?.name?.firstOrNull()?.uppercase() ?: str(Strings.courier).first().uppercase().toString(),
                            style = MaterialTheme.typography.headlineMedium,
                            color = MaterialTheme.colorScheme.onPrimary
                        )
                    }

                    Spacer(modifier = Modifier.width(16.dp))

                    Column(modifier = Modifier.weight(1f)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = state.user?.name ?: str(Strings.courier),
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Bold
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = if ((state.user?.balance ?: 0.0) >= 5.0)
                                    AccentGreen.copy(alpha = 0.15f)
                                else
                                    AccentRed.copy(alpha = 0.15f)
                            ) {
                                Text(
                                    text = "${(state.user?.balance ?: 0.0).toLong()} с.",
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = if ((state.user?.balance ?: 0.0) >= 5.0) AccentGreen else AccentRed,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                                )
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(
                                        if (state.user?.isOnline == true) StatusOnline
                                        else StatusOffline
                                    )
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = if (state.user?.isOnline == true) str(Strings.online) else str(Strings.offline),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            // Stats cards
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                StatCard(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Default.AttachMoney,
                    title = str(Strings.earnings),
                    value = LocationUtils.formatCost(state.todayStats.totalEarnings),
                    color = AccentGreen
                )
                StatCard(
                    modifier = Modifier.weight(1f),
                    icon = Icons.Default.DeliveryDining,
                    title = str(Strings.deliveries),
                    value = "${state.todayStats.deliveryCount}",
                    color = AccentBlue
                )
            }

            Spacer(modifier = Modifier.weight(1f))

            // Delivery chain button
            OutlinedButton(
                onClick = onChainClick,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(16.dp)
            ) {
                Icon(Icons.Default.List, contentDescription = null, modifier = Modifier.size(22.dp))
                Spacer(modifier = Modifier.width(10.dp))
                Text("Дерево заказов", style = MaterialTheme.typography.titleMedium)
            }

            Spacer(modifier = Modifier.height(10.dp))

            // Start delivery button
            Button(
                onClick = {
                    viewModel.showDeliveryTypeDialog()
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(64.dp),
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary
                )
            ) {
                Icon(
                    Icons.Default.PlayArrow,
                    contentDescription = null,
                    modifier = Modifier.size(28.dp)
                )
                Spacer(modifier = Modifier.width(12.dp))
                Text(
                    text = str(Strings.startTrip),
                    style = MaterialTheme.typography.titleLarge
                )
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }

    // Delivery type selection dialog
    if (state.showDeliveryTypeDialog) {
        AlertDialog(
            onDismissRequest = { viewModel.hideDeliveryTypeDialog() },
            title = { Text(str(Strings.selectDeliveryType)) },
            text = {
                Column(
                    modifier = Modifier.fillMaxWidth()
                ) {
                    DeliveryTypeOption(
                        selected = state.selectedDeliveryType == "default",
                        onClick = { viewModel.onDeliveryTypeSelected("default") },
                        title = str(Strings.counterBased),
                        subtitle = str(Strings.paymentByKilometer)
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    
                    val fixedTypes = state.fixedTypes
                    if (fixedTypes.isNotEmpty()) {
                        if (fixedTypes["coal"] ?: 0.0 > 0) {
                            DeliveryTypeOption(
                                selected = state.selectedDeliveryType == "coal",
                                onClick = { viewModel.onDeliveryTypeSelected("coal") },
                                title = str(Strings.coal),
                                subtitle = "${str(Strings.fixedPrice)}: ${fixedTypes["coal"]?.toLong() ?: 0} ${str(Strings.somoni)}"
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                        }
                        
                        // Gas options - show as sub-options
                        val hasGas = (fixedTypes["gas15"] ?: 0.0 > 0) || 
                                     (fixedTypes["gas30"] ?: 0.0 > 0) || 
                                     (fixedTypes["gas30plus"] ?: 0.0 > 0)
                        
                        if (hasGas) {
                            if (fixedTypes["gas15"] ?: 0.0 > 0) {
                                DeliveryTypeOption(
                                    selected = state.selectedDeliveryType == "gas15",
                                    onClick = { viewModel.onDeliveryTypeSelected("gas15") },
                                    title = str(Strings.gas15),
                                    subtitle = "${str(Strings.fixedPrice)}: ${fixedTypes["gas15"]?.toLong() ?: 0} ${str(Strings.somoni)}"
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                            }
                            
                            if (fixedTypes["gas30"] ?: 0.0 > 0) {
                                DeliveryTypeOption(
                                    selected = state.selectedDeliveryType == "gas30",
                                    onClick = { viewModel.onDeliveryTypeSelected("gas30") },
                                    title = str(Strings.gas30),
                                    subtitle = "${str(Strings.fixedPrice)}: ${fixedTypes["gas30"]?.toLong() ?: 0} ${str(Strings.somoni)}"
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                            }
                            
                            if (fixedTypes["gas30plus"] ?: 0.0 > 0) {
                                DeliveryTypeOption(
                                    selected = state.selectedDeliveryType == "gas30plus",
                                    onClick = { viewModel.onDeliveryTypeSelected("gas30plus") },
                                    title = str(Strings.gas30plus),
                                    subtitle = "${str(Strings.fixedPrice)}: ${fixedTypes["gas30plus"]?.toLong() ?: 0} ${str(Strings.somoni)}"
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                            }
                        }
                        
                        if (fixedTypes["errands"] ?: 0.0 > 0) {
                            DeliveryTypeOption(
                                selected = state.selectedDeliveryType == "errands",
                                onClick = { viewModel.onDeliveryTypeSelected("errands") },
                                title = str(Strings.errands),
                                subtitle = "${str(Strings.fixedPrice)}: ${fixedTypes["errands"]?.toLong() ?: 0} ${str(Strings.somoni)}"
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                        }
                        
                        if (fixedTypes["heavyCargo"] ?: 0.0 > 0) {
                            DeliveryTypeOption(
                                selected = state.selectedDeliveryType == "heavyCargo",
                                onClick = { viewModel.onDeliveryTypeSelected("heavyCargo") },
                                title = str(Strings.heavyCargo),
                                subtitle = "${str(Strings.fixedPrice)}: ${fixedTypes["heavyCargo"]?.toLong() ?: 0} ${str(Strings.somoni)}"
                            )
                        }
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = { viewModel.proceedToPhoneInput() }
                ) {
                    Text(str(Strings.next))
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.hideDeliveryTypeDialog() }) {
                    Text(str(Strings.cancel))
                }
            }
        )
    }

    // Start delivery dialog
    if (state.showStartDialog) {
        AlertDialog(
            onDismissRequest = { viewModel.hideStartDialog() },
            title = { Text(str(Strings.newDelivery)) },
            text = {
                Column {
                    OutlinedTextField(
                        value = state.clientPhone,
                        onValueChange = viewModel::onClientPhoneChange,
                        label = { Text(str(Strings.clientPhoneNumber)) },
                        leadingIcon = {
                            Icon(Icons.Default.Phone, contentDescription = null)
                        },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Phone
                        ),
                        shape = RoundedCornerShape(12.dp)
                    )
                    if (state.error != null) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = state.error ?: "",
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.startDelivery()
                    },
                    enabled = !state.isStartingDelivery
                ) {
                    if (state.isStartingDelivery) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp
                        )
                    } else {
                        Text(str(Strings.start))
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.hideStartDialog() }) {
                    Text(str(Strings.cancel))
                }
            }
        )
    }
    
    // Language dialog
    if (showLanguageDialog) {
        com.zaki.taksometr.presentation.components.LanguageDialog(
            currentLanguage = currentLanguage,
            onDismiss = { showLanguageDialog = false },
            onLanguageSelected = { language ->
                // Restart activity to apply language change
                val activity = context as? android.app.Activity
                activity?.recreate()
            }
        )
    }
}

@Composable
fun DeliveryTypeOption(
    selected: Boolean,
    onClick: () -> Unit,
    title: String,
    subtitle: String
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (selected) 
                MaterialTheme.colorScheme.primaryContainer 
            else 
                MaterialTheme.colorScheme.surface
        ),
        elevation = CardDefaults.cardElevation(
            defaultElevation = if (selected) 4.dp else 1.dp
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            RadioButton(
                selected = selected,
                onClick = onClick
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                )
            }
        }
    }
}

@Composable
fun StatCard(
    modifier: Modifier = Modifier,
    icon: ImageVector,
    title: String,
    value: String,
    color: androidx.compose.ui.graphics.Color
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = color,
                modifier = Modifier.size(32.dp)
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = value,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
        }
    }
}


private fun isLocationEnabled(context: Context): Boolean {
    val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    return locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
            locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
}
