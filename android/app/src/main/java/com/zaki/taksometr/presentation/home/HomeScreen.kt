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
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
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
import androidx.compose.ui.unit.sp
import com.zaki.taksometr.presentation.components.SwipeToAcceptButton
import com.zaki.taksometr.presentation.components.CourierBottomBar
import com.zaki.taksometr.presentation.components.CourierTab
import com.zaki.taksometr.presentation.profile.CourierNotificationsViewModel
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
import com.zaki.taksometr.util.Greeting
import com.zaki.taksometr.util.str
import com.zaki.taksometr.util.Strings
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(
    ExperimentalPermissionsApi::class,
    ExperimentalMaterial3Api::class,
    ExperimentalMaterialApi::class
)
@Composable
fun HomeScreen(
    onStartDelivery: () -> Unit,
    onOrdersMapClick: () -> Unit,
    onNotificationsClick: () -> Unit,
    onProfileClick: () -> Unit,
    onLogout: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel(),
    notificationsViewModel: CourierNotificationsViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    val inboxState by notificationsViewModel.state.collectAsState()
    val context = LocalContext.current

    val snackbarHostState = remember { SnackbarHostState() }

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
    var greetingHour by remember { mutableIntStateOf(Greeting.currentHour()) }

    LaunchedEffect(Unit) {
        while (true) {
            greetingHour = Greeting.currentHour()
            delay(60_000L)
        }
    }

    // Re-check GPS when app resumes (user might have enabled it in settings)
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                greetingHour = Greeting.currentHour()
                notificationsViewModel.refresh()
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
        containerColor = CourierCanvas,

            topBar = {
                TopAppBar(
                    title = { Text("ZaKi") },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = CourierSky,
                        titleContentColor = CourierBlueDark
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
                        colors = ButtonDefaults.buttonColors(containerColor = CourierBlue)
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

    // Continuous "on shift" tracking: run the always-on tracker whenever the
    // courier is on shift and location is granted+enabled, and stop it as soon as
    // they go off shift or log out. This is what lets the dispatcher see where a
    // courier drives even when they work without starting the meter.
    LaunchedEffect(
        state.user?.id,
        state.user?.isOnShift,
        locationPermissions.allPermissionsGranted,
        isGpsEnabled
    ) {
        val onShift = state.user?.isOnShift == true && state.user?.id != null
        if (onShift && locationPermissions.allPermissionsGranted && isGpsEnabled) {
            com.zaki.taksometr.service.ShiftTrackingService.start(context)
        } else {
            com.zaki.taksometr.service.ShiftTrackingService.stop(context)
        }
    }

    LaunchedEffect(state.error) {
        state.error?.let { snackbarHostState.showSnackbar(it) }
    }

    val noInternetMessage = str(Strings.noInternetConnection)
    val refreshFailedMessage = str(Strings.refreshFailed)
    LaunchedEffect(state.refreshError, noInternetMessage, refreshFailedMessage) {
        state.refreshError?.let { refreshError ->
            val message = when (refreshError) {
                HomeRefreshError.NO_INTERNET -> noInternetMessage
                HomeRefreshError.FAILED -> refreshFailedMessage
            }
            snackbarHostState.showSnackbar(message)
            viewModel.consumeRefreshError()
        }
    }

    Scaffold(
        containerColor = CourierCanvas,
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("ZaKi", fontSize = 25.sp, fontWeight = FontWeight.Bold, color = CourierBlueDark)
                        Text(state.user?.city?.takeIf { it.isNotBlank() } ?: "Душанбе", fontSize = 11.sp, color = CourierMuted)
                    }
                },
                actions = {
                    IconButton(onClick = onNotificationsClick) {
                        BadgedBox(badge = {
                            if (inboxState.hasUnread) Badge()
                        }) {
                            Icon(Icons.Default.Notifications, contentDescription = "Уведомления")
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = CourierSky,
                    titleContentColor = CourierInk,
                    actionIconContentColor = CourierBlueDark
                )
            )
        },
        bottomBar = {
            CourierBottomBar(
                selected = CourierTab.HOME,
                onHome = {},
                onOrders = onOrdersMapClick,
                onProfile = onProfileClick
            )
        }
    ) { paddingValues ->
        val pullRefreshState = rememberPullRefreshState(
            refreshing = state.isRefreshing,
            onRefresh = viewModel::refreshHome
        )

        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(CourierCanvas)
                .pullRefresh(pullRefreshState)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        // A small elastic pull makes the refresh gesture visible
                        // immediately, even before the indicator reaches its trigger.
                        val pull = pullRefreshState.progress.coerceIn(0f, 1.5f)
                        translationY = pull * 48.dp.toPx()
                        scaleY = 1f + pull * 0.012f
                        transformOrigin = TransformOrigin(0.5f, 0f)
                    }
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
            // Combined courier info + stats card
            Text(
                text = "${str(Greeting.forHour(greetingHour))}, ${state.user?.name?.substringBefore(' ')?.takeIf { it.isNotBlank() } ?: str(Strings.courier)}!",
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                color = CourierInk
            )
            Text(
                text = str(Strings.readyForDeliveries),
                modifier = Modifier.fillMaxWidth().padding(top = 3.dp, bottom = 16.dp),
                color = CourierMuted,
                style = MaterialTheme.typography.bodyMedium
            )
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(22.dp),
                colors = CardDefaults.cardColors(containerColor = CourierSky),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
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
                        com.zaki.taksometr.presentation.components.CourierAvatar(
                            photoBase64 = state.user?.photoBase64,
                            fallbackLetter = state.user?.name?.firstOrNull()?.uppercase()
                                ?: str(Strings.courier).first().uppercase().toString(),
                            size = 56.dp,
                            letterStyle = MaterialTheme.typography.headlineMedium
                        )

                        Spacer(modifier = Modifier.width(16.dp))

                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = state.user?.name ?: str(Strings.courier),
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Bold
                            )
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                // Status reflects the manual shift switch: "На работе"
                                // when on shift, otherwise offline.
                                val onShiftStatus = state.user?.isOnShift ?: true
                                Box(
                                    modifier = Modifier
                                        .size(8.dp)
                                        .clip(CircleShape)
                                        .background(
                                            if (onShiftStatus) StatusOnline
                                            else StatusOffline
                                        )
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = if (onShiftStatus) str(Strings.onShift) else str(Strings.offShift),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = CourierMuted
                                )
                            }
                        }

                        // Manual "on shift" toggle. When off, the courier is
                        // excluded from new order distribution and push.
                        val onShift = state.user?.isOnShift ?: true
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Switch(
                                checked = onShift,
                                onCheckedChange = { viewModel.toggleShift(it) },
                                enabled = !state.isUpdatingShift,
                                colors = SwitchDefaults.colors(
                                    checkedTrackColor = CourierGreen
                                )
                            )
                            Text(
                                text = if (onShift) str(Strings.onShift) else str(Strings.offShift),
                                style = MaterialTheme.typography.labelSmall,
                                color = if (onShift) CourierGreen else CourierMuted
                            )
                        }
                    }

                    // Thin divider
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(1.dp)
                            .background(CourierLine)
                    )

                    // Stats row embedded in card
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(CourierHeroBrush)
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
                                    tint = Color.White,
                                    modifier = Modifier.size(20.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = LocationUtils.formatCost(state.todayStats.totalEarnings),
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = Color.White
                                )
                            }
                            Text(
                                text = str(Strings.earnings),
                                style = MaterialTheme.typography.labelSmall,
                                color = Color.White.copy(alpha = 0.8f)
                            )
                        }

                        Box(
                            modifier = Modifier
                                .width(1.dp)
                                .height(36.dp)
                                .background(Color.White.copy(alpha = 0.3f))
                        )

                        Column(
                            modifier = Modifier.weight(1f),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Default.DeliveryDining,
                                    contentDescription = null,
                                    tint = Color.White,
                                    modifier = Modifier.size(20.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = "${state.todayStats.deliveryCount}",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = Color.White
                                )
                            }
                            Text(
                                text = str(Strings.deliveries),
                                style = MaterialTheme.typography.labelSmall,
                                color = Color.White.copy(alpha = 0.8f)
                            )
                        }
                    }
                }
            }

            Button(
                onClick = { viewModel.showDeliveryTypeDialog() },
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp).height(54.dp),
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = CourierBlueSoft,
                    contentColor = CourierBlueDark
                ),
                elevation = ButtonDefaults.buttonElevation(defaultElevation = 0.dp)
            ) {
                Icon(Icons.Default.PlayArrow, contentDescription = null)
                Spacer(modifier = Modifier.width(10.dp))
                Text(str(Strings.startTrip), fontWeight = FontWeight.Bold)
            }

            // Active delivery card — lets the courier return to the running meter
            // (auto-open no longer forces them back, so they can take a 2nd order).
            state.activeDelivery?.let { active ->
                Spacer(modifier = Modifier.height(12.dp))
                val paused = active.isPaused
                val accent = if (paused) AccentOrange else CourierBlueDark
                Card(
                    onClick = {
                        LocationTrackingService.startService(context)
                        onStartDelivery()
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(20.dp),
                    colors = CardDefaults.cardColors(containerColor = CourierSky),
                    border = BorderStroke(1.dp, CourierLine),
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
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
                                    fontWeight = FontWeight.Bold,
                                    color = CourierInk
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
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = str(Strings.newOrders),
                    modifier = Modifier.weight(1f),
                    fontSize = 21.sp,
                    fontWeight = FontWeight.Bold,
                    color = CourierInk
                )
                TextButton(
                    onClick = onOrdersMapClick,
                    colors = ButtonDefaults.textButtonColors(contentColor = CourierBlueDark)
                ) {
                    Text("${str(Strings.ordersMap)} →", fontWeight = FontWeight.Bold)
                }
            }
            if (state.pendingMarketplaceOrders.isNotEmpty()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Spacer(modifier = Modifier.height(4.dp))
                    state.pendingMarketplaceOrders.forEach { pending ->
                        PendingOrderCard(
                            pending = pending,
                            isAccepting = state.isAcceptingMarketplaceOrder,
                            onAccept = { viewModel.acceptPendingMarketplaceOrder(pending.id) },
                            onDecline = { viewModel.declineSmartDispatchOffer(pending.id) }
                        )
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                }
            } else {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(20.dp),
                    colors = CardDefaults.cardColors(containerColor = CourierSurface),
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
                ) {
                    Text(
                        text = str(Strings.noNewOrders),
                        modifier = Modifier.padding(20.dp),
                        color = CourierMuted,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }

            }

            PullRefreshIndicator(
                refreshing = state.isRefreshing,
                state = pullRefreshState,
                modifier = Modifier.align(Alignment.TopCenter),
                backgroundColor = MaterialTheme.colorScheme.surface,
                contentColor = CourierBlue,
                scale = true
            )
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

    // Winner-of-the-month congratulation dialog
    if (state.showWinnerDialog) {
        state.winnerAnnouncement?.let { winner ->
            WinnerCongratsDialog(
                winner = winner,
                onDismiss = { viewModel.dismissWinnerDialog() }
            )
        }
    }
}

@Composable
fun WinnerCongratsDialog(
    winner: WinnerAnnouncement,
    onDismiss: () -> Unit
) {
    val gold = Color(0xFFFFC107)
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                Icons.Default.EmojiEvents,
                contentDescription = null,
                tint = gold,
                modifier = Modifier.size(48.dp)
            )
        },
        title = {
            Text(
                text = if (winner.isWinner) "🎉 Поздравляем!" else "🏆 Победитель месяца",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                if (winner.isWinner) {
                    // Full personal congratulation for the winner.
                    Text(
                        text = winner.congratsText,
                        style = MaterialTheme.typography.bodyLarge,
                        textAlign = TextAlign.Center
                    )
                } else {
                    // Short summary for the other couriers.
                    Text(
                        text = "Победитель этого месяца — ${winner.winnerName}!",
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))

                // Prize + order-count summary badges.
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    if (winner.prizeAmount > 0) {
                        WinnerStat(
                            icon = Icons.Default.AttachMoney,
                            value = LocationUtils.formatCost(winner.prizeAmount),
                            label = "Премия",
                            color = AccentGreen
                        )
                    }
                    if (winner.orderCount > 0) {
                        WinnerStat(
                            icon = Icons.Default.DeliveryDining,
                            value = "${winner.orderCount}",
                            label = "Доставок",
                            color = AccentBlue
                        )
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = onDismiss) {
                Text(if (winner.isWinner) "Спасибо!" else "Поздравить")
            }
        }
    )
}

@Composable
private fun WinnerStat(
    icon: ImageVector,
    value: String,
    label: String,
    color: Color
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(28.dp))
        Spacer(modifier = Modifier.height(4.dp))
        Text(text = value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
        )
    }
}

private val PendingOrderTextColor: Color @Composable get() = CourierInk
private val PendingOrderLabelColor: Color @Composable get() = CourierMuted

@Composable
fun PendingOrderCard(
    pending: PendingMarketplaceOrder,
    isAccepting: Boolean,
    onAccept: () -> Unit,
    onDecline: () -> Unit
) {
    val context = LocalContext.current
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = CourierSurface),
        border = BorderStroke(1.dp, CourierLine),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
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
                        tint = CourierBlue,
                        modifier = Modifier.size(22.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = str(Strings.newOrder),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = CourierInk
                    )
                }
                Surface(shape = RoundedCornerShape(20.dp), color = CourierBlueSoft) {
                    Text(
                        text = "Новый!",
                        style = MaterialTheme.typography.labelSmall,
                        color = CourierBlueDark,
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
                .background(CourierLine)
            )

            OrderAcceptanceTimer(pending)

            if (pending.pickupAddress.isNotBlank() || (pending.pickupLat != null && pending.pickupLng != null)) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.LocationOn, contentDescription = null, tint = AccentGreen, modifier = Modifier.size(20.dp))
                    Spacer(modifier = Modifier.width(10.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Откуда", style = MaterialTheme.typography.labelSmall, color = PendingOrderLabelColor)
                        Text(pending.pickupAddress.ifBlank { "Точка на карте" }, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = PendingOrderTextColor)
                    }
                    NavigateIconButton(
                        onClick = {
                            com.zaki.taksometr.util.IntentUtils.openNavigation(
                                context, pending.pickupLat, pending.pickupLng, pending.pickupAddress
                            )
                        }
                    )
                }
                Spacer(modifier = Modifier.height(10.dp))
            }
            if (pending.destinationAddress.isNotBlank() || (pending.destinationLat != null && pending.destinationLng != null)) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.LocationOn, contentDescription = null, tint = AccentRed, modifier = Modifier.size(20.dp))
                    Spacer(modifier = Modifier.width(10.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Куда", style = MaterialTheme.typography.labelSmall, color = PendingOrderLabelColor)
                        Text(pending.destinationAddress.ifBlank { "Точка на карте" }, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = PendingOrderTextColor)
                    }
                    NavigateIconButton(
                        onClick = {
                            com.zaki.taksometr.util.IntentUtils.openNavigation(
                                context, pending.destinationLat, pending.destinationLng, pending.destinationAddress
                            )
                        }
                    )
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
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp)
                    .height(1.dp)
                    .background(CourierLine)
            )

            SwipeToAcceptButton(
                isAccepting = isAccepting,
                onAccept = onAccept,
                accentColor = CourierBlue,
                onAccentColor = Color.White
            )
            if (pending.isSmartOffer) {
                TextButton(
                    onClick = onDecline,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isAccepting
                ) { Text("Отказаться от предложения") }
            }
        }
    }
}

/** Live response clock for an unaccepted dispatcher order. */
@Composable
private fun OrderAcceptanceTimer(pending: PendingMarketplaceOrder) {
    var now by remember(pending.id) { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(pending.id, pending.createdAt) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1_000)
        }
    }
    val offerLimitMs = pending.offerExpiresAt?.let { (it - pending.createdAt).coerceAtLeast(1L) }
    val elapsed = (now - pending.createdAt).coerceAtLeast(0L)
    val limitMinutes = pending.acceptanceLimitMinutes.coerceAtLeast(1)
    val isOverdue = pending.offerExpiresAt?.let { now >= it } ?: (elapsed >= limitMinutes * 60_000L)
    val timerColor = if (isOverdue) AccentRed else CourierBlueDark
    val createdLabel = if (pending.createdAt > 0L) {
        SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault()).format(Date(pending.createdAt))
    } else "—"

    Spacer(modifier = Modifier.height(12.dp))
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column {
            Text("Создан: $createdLabel", style = MaterialTheme.typography.labelSmall, color = PendingOrderLabelColor)
            Text(if (pending.isSmartOffer && offerLimitMs != null) "Персональное предложение: ${offerLimitMs / 1000} сек" else "На принятие: $limitMinutes мин", style = MaterialTheme.typography.labelSmall, color = PendingOrderLabelColor)
        }
        Text(
            text = "${LocationUtils.formatDuration(elapsed)}${if (isOverdue) " · просрочен" else ""}",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Bold,
            color = timerColor
        )
    }
    Spacer(modifier = Modifier.height(12.dp))
}

// Small round button that launches external turn-by-turn navigation to a point.
@Composable
fun NavigateIconButton(onClick: () -> Unit) {
    FilledTonalIconButton(
        onClick = onClick,
        colors = IconButtonDefaults.filledTonalIconButtonColors(
            containerColor = AccentBlue.copy(alpha = 0.15f),
            contentColor = AccentBlue
        )
    ) {
        Icon(Icons.Default.Navigation, contentDescription = "Построить маршрут")
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
