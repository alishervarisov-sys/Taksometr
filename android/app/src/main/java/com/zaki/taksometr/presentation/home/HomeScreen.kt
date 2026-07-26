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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.zaki.taksometr.presentation.components.SwipeToAcceptButton
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberMultiplePermissionsState
import com.google.accompanist.permissions.rememberPermissionState
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
    onProfileClick: () -> Unit,
    onLogout: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    
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

    // Request POST_NOTIFICATIONS on Android 13+ (API 33+) so FCM push
    // notifications can actually appear in the status bar.
    val notificationPermission = if (android.os.Build.VERSION.SDK_INT >= 33) {
        rememberPermissionState(Manifest.permission.POST_NOTIFICATIONS)
    } else null

    LaunchedEffect(Unit) {
        notificationPermission?.let {
            if (!it.status.isGranted) it.launchPermissionRequest()
        }
    }

    // Check if GPS is enabled
    var isGpsEnabled by remember { mutableStateOf(isLocationEnabled(context)) }

    // Re-check GPS when app resumes (user might have enabled it in settings)
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                isGpsEnabled = isLocationEnabled(context)
                if (locationPermissions.allPermissionsGranted && isGpsEnabled) {
                    viewModel.refreshCourierLocation()
                }
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

    LaunchedEffect(locationPermissions.allPermissionsGranted, isGpsEnabled) {
        if (locationPermissions.allPermissionsGranted && isGpsEnabled) {
            viewModel.refreshCourierLocation()
            viewModel.syncRemoteActiveDelivery()
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

    // Auto-open the active delivery screen only when a delivery *newly* becomes
    // active (started/accepted/first sync). We remember the last id we already
    // opened, so returning to Home (back button) while the meter is running does
    // NOT bounce the courier straight back — they can stay here to take a 2nd order.
    var lastOpenedActiveId by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(state.activeDelivery?.id) {
        val activeId = state.activeDelivery?.id
        if (activeId != null && activeId != lastOpenedActiveId) {
            lastOpenedActiveId = activeId
            LocationTrackingService.startService(context)
            onStartDelivery()
        }
    }

    LaunchedEffect(state.error) {
        state.error?.let { snackbarHostState.showSnackbar(it) }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
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
                    IconButton(onClick = onProfileClick) {
                        Icon(Icons.Default.AccountCircle, contentDescription = str(Strings.profile))
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
            // Combined courier info + stats card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
            ) {
                Column(modifier = Modifier.fillMaxWidth()) {
                    // Courier info row
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp, vertical = 16.dp),
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
                            Row(verticalAlignment = Alignment.CenterVertically) {
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
                                        text = LocationUtils.formatCost(state.user?.balance ?: 0.0),
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

                    // Thin divider
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(1.dp)
                            .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f))
                    )

                    // Stats row embedded in card
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(
                            modifier = Modifier.weight(1f),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Default.AttachMoney,
                                    contentDescription = null,
                                    tint = AccentGreen,
                                    modifier = Modifier.size(20.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = LocationUtils.formatCost(state.todayStats.totalEarnings),
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                            Text(
                                text = str(Strings.earnings),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                            )
                        }

                        Box(
                            modifier = Modifier
                                .width(1.dp)
                                .height(36.dp)
                                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.15f))
                        )

                        Column(
                            modifier = Modifier.weight(1f),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Default.DeliveryDining,
                                    contentDescription = null,
                                    tint = AccentBlue,
                                    modifier = Modifier.size(20.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = "${state.todayStats.deliveryCount}",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                            Text(
                                text = str(Strings.deliveries),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                            )
                        }
                    }
                }
            }

            // Active delivery card — lets the courier return to the running meter
            // (auto-open no longer forces them back, so they can take a 2nd order).
            state.activeDelivery?.let { active ->
                Spacer(modifier = Modifier.height(12.dp))
                val paused = active.isPaused
                val accent = if (paused) AccentOrange else AccentGreen
                Card(
                    onClick = {
                        LocationTrackingService.startService(context)
                        onStartDelivery()
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = accent.copy(alpha = 0.12f)),
                    border = BorderStroke(1.5.dp, accent),
                    elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            if (paused) Icons.Default.PauseCircle else Icons.Default.DeliveryDining,
                            contentDescription = null,
                            tint = accent,
                            modifier = Modifier.size(28.dp)
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = str(Strings.activeDeliveryTitle),
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold
                                )
                                if (state.activeCount > 1) {
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Surface(
                                        shape = RoundedCornerShape(8.dp),
                                        color = accent.copy(alpha = 0.2f)
                                    ) {
                                        Text(
                                            text = "${state.activeCount}",
                                            style = MaterialTheme.typography.labelMedium,
                                            fontWeight = FontWeight.Bold,
                                            color = accent,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                                        )
                                    }
                                }
                            }
                            Text(
                                text = if (paused) str(Strings.meterPaused) else str(Strings.meterRunning),
                                style = MaterialTheme.typography.bodySmall,
                                color = accent
                            )
                            if (active.clientPhone.isNotBlank()) {
                                Text(
                                    text = active.clientPhone,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                                )
                            }
                        }
                        Icon(
                            Icons.Default.ChevronRight,
                            contentDescription = null,
                            tint = accent
                        )
                    }
                }
            }

            // Scrollable orders area — takes all remaining space. Pending orders
            // are shown while the courier is below the concurrent-order limit
            // (the list is already gated by the view model).
            if (state.pendingMarketplaceOrders.isNotEmpty()) {
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Spacer(modifier = Modifier.height(4.dp))
                    state.pendingMarketplaceOrders.forEach { pending ->
                        PendingOrderCard(
                            pending = pending,
                            isAccepting = state.isAcceptingMarketplaceOrder,
                            onAccept = { viewModel.acceptPendingMarketplaceOrder(pending.id) }
                        )
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                }
            } else {
                Spacer(modifier = Modifier.weight(1f))
            }

            Spacer(modifier = Modifier.height(12.dp))

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
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                ) {
                    DeliveryTypeOption(
                        selected = state.selectedDeliveryType == "default",
                        onClick = { viewModel.onDeliveryTypeSelected("default") },
                        title = str(Strings.counterBased),
                        subtitle = str(Strings.paymentByKilometer)
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    
                    DeliveryTypeOption(
                        selected = state.selectedDeliveryType == "heavyCargoMeter",
                        onClick = { viewModel.onDeliveryTypeSelected("heavyCargoMeter") },
                        title = str(Strings.heavyCargoMeter),
                        subtitle = str(Strings.heavyCargoMeterSubtitle)
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    
                    val fixedTypes = state.fixedTypes
                    if (fixedTypes.isNotEmpty()) {
                        if (fixedTypes["coal"] ?: 0.0 > 0) {
                            DeliveryTypeOption(
                                selected = state.selectedDeliveryType == "coal",
                                onClick = { viewModel.onDeliveryTypeSelected("coal") },
                                title = str(Strings.coal),
                                subtitle = "${str(Strings.fixedPrice)}: ${LocationUtils.formatCost(fixedTypes["coal"] ?: 0.0)}"
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
                                    subtitle = "${str(Strings.fixedPrice)}: ${LocationUtils.formatCost(fixedTypes["gas15"] ?: 0.0)}"
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                            }
                            
                            if (fixedTypes["gas30"] ?: 0.0 > 0) {
                                DeliveryTypeOption(
                                    selected = state.selectedDeliveryType == "gas30",
                                    onClick = { viewModel.onDeliveryTypeSelected("gas30") },
                                    title = str(Strings.gas30),
                                    subtitle = "${str(Strings.fixedPrice)}: ${LocationUtils.formatCost(fixedTypes["gas30"] ?: 0.0)}"
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                            }
                            
                            if (fixedTypes["gas30plus"] ?: 0.0 > 0) {
                                DeliveryTypeOption(
                                    selected = state.selectedDeliveryType == "gas30plus",
                                    onClick = { viewModel.onDeliveryTypeSelected("gas30plus") },
                                    title = str(Strings.gas30plus),
                                    subtitle = "${str(Strings.fixedPrice)}: ${LocationUtils.formatCost(fixedTypes["gas30plus"] ?: 0.0)}"
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                            }
                        }
                        
                        if (fixedTypes["errands"] ?: 0.0 > 0) {
                            DeliveryTypeOption(
                                selected = state.selectedDeliveryType == "errands",
                                onClick = { viewModel.onDeliveryTypeSelected("errands") },
                                title = str(Strings.errands),
                                subtitle = "${str(Strings.fixedPrice)}: ${LocationUtils.formatCost(fixedTypes["errands"] ?: 0.0)}"
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                        }
                        
                        if (fixedTypes["heavyCargo"] ?: 0.0 > 0) {
                            DeliveryTypeOption(
                                selected = state.selectedDeliveryType == "heavyCargo",
                                onClick = { viewModel.onDeliveryTypeSelected("heavyCargo") },
                                title = str(Strings.heavyCargo),
                                subtitle = "${str(Strings.fixedPrice)}: ${LocationUtils.formatCost(fixedTypes["heavyCargo"] ?: 0.0)}"
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

// The pending-order card always has a fixed light (cream) background, so its
// text must use fixed dark colors — otherwise in dark/night theme the default
// onSurface color turns light and the order text becomes invisible.
private val PendingOrderTextColor = Color(0xFF212121)
private val PendingOrderLabelColor = Color(0xFF6D4C41)

@Composable
fun PendingOrderCard(
    pending: PendingMarketplaceOrder,
    isAccepting: Boolean,
    onAccept: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF8E1)),
        border = BorderStroke(1.5.dp, Color(0xFFFFB300)),
        elevation = CardDefaults.cardElevation(defaultElevation = 6.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp)
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Default.LocalShipping,
                        contentDescription = null,
                        tint = Color(0xFFE65100),
                        modifier = Modifier.size(22.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Свободный заказ",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFFE65100)
                    )
                }
                Surface(shape = RoundedCornerShape(20.dp), color = Color(0xFFFF6F00)) {
                    Text(
                        text = "Новый!",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xFFFFFFFF),
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                    )
                }
            }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 12.dp)
                    .height(1.dp)
                    .background(Color(0xFFFFB300).copy(alpha = 0.5f))
            )

            if (pending.pickupAddress.isNotBlank()) {
                Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.LocationOn, contentDescription = null, tint = AccentGreen, modifier = Modifier.size(20.dp))
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text("Откуда", style = MaterialTheme.typography.labelSmall, color = PendingOrderLabelColor)
                        Text(pending.pickupAddress, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = PendingOrderTextColor)
                    }
                }
                Spacer(modifier = Modifier.height(10.dp))
            }
            if (pending.destinationAddress.isNotBlank()) {
                Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.LocationOn, contentDescription = null, tint = AccentRed, modifier = Modifier.size(20.dp))
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text("Куда", style = MaterialTheme.typography.labelSmall, color = PendingOrderLabelColor)
                        Text(pending.destinationAddress, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = PendingOrderTextColor)
                    }
                }
                Spacer(modifier = Modifier.height(10.dp))
            }
            if (pending.comment.isNotBlank()) {
                Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Comment, contentDescription = null, tint = AccentBlue, modifier = Modifier.size(20.dp))
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text("Комментарий", style = MaterialTheme.typography.labelSmall, color = PendingOrderLabelColor)
                        Text(pending.comment, style = MaterialTheme.typography.bodyMedium, color = PendingOrderTextColor)
                    }
                }
                Spacer(modifier = Modifier.height(10.dp))
            }
            if (pending.clientPhone.isNotBlank()) {
                Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Phone, contentDescription = null, tint = PendingOrderLabelColor, modifier = Modifier.size(20.dp))
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text("Клиент", style = MaterialTheme.typography.labelSmall, color = PendingOrderLabelColor)
                        Text(pending.clientPhone, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = PendingOrderTextColor)
                    }
                }
                Spacer(modifier = Modifier.height(12.dp))
            }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp)
                    .height(1.dp)
                    .background(Color(0xFFFFB300).copy(alpha = 0.5f))
            )

            SwipeToAcceptButton(
                isAccepting = isAccepting,
                onAccept = onAccept
            )
        }
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
