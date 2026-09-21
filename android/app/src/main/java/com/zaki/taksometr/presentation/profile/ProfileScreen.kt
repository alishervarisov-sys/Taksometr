package com.zaki.taksometr.presentation.profile

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.zaki.taksometr.presentation.components.CourierAvatar
import com.zaki.taksometr.presentation.components.CourierBottomBar
import com.zaki.taksometr.presentation.components.CourierTab
import com.zaki.taksometr.presentation.components.LanguageDialog
import com.zaki.taksometr.presentation.theme.*
import com.zaki.taksometr.util.LocationUtils
import com.zaki.taksometr.util.Constants
import com.zaki.taksometr.util.LocalizationManager
import com.zaki.taksometr.util.Strings
import com.zaki.taksometr.util.str
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    onBack: () -> Unit,
    onLogout: () -> Unit,
    onHistoryClick: () -> Unit,
    onDaysClick: () -> Unit,
    onTransactionsClick: () -> Unit,
    onNotificationsClick: () -> Unit,
    viewModel: ProfileViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    var showLogoutDialog by remember { mutableStateOf(false) }
    var showTransferDialog by remember { mutableStateOf(false) }
    var transferMenuExpanded by remember { mutableStateOf(false) }
    var selectedTransferRecipient by remember { mutableStateOf<TransferRecipient?>(null) }
    var transferAmount by remember { mutableStateOf("") }
    val snackbarHostState = remember { SnackbarHostState() }
    val nightModeState = LocalNightModeState.current
    var showLanguageDialog by remember { mutableStateOf(false) }
    val prefs = remember {
        context.getSharedPreferences(Constants.PREFS_NAME, android.content.Context.MODE_PRIVATE)
    }
    val currentLanguage = remember(showLanguageDialog) {
        LocalizationManager.getCurrentLanguage(prefs)
    }

    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        if (uri != null) viewModel.onPhotoSelected(uri)
    }

    LaunchedEffect(state.photoError) {
        state.photoError?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearPhotoError()
        }
    }

    LaunchedEffect(state.transferSuccess) {
        state.transferSuccess?.let {
            showTransferDialog = false
            selectedTransferRecipient = null
            transferAmount = ""
            snackbarHostState.showSnackbar(it)
            viewModel.clearTransferMessage()
        }
    }

    LaunchedEffect(state.user?.balanceTransferEnabled) {
        if (state.user?.balanceTransferEnabled == false) {
            showTransferDialog = false
            transferMenuExpanded = false
            selectedTransferRecipient = null
            transferAmount = ""
            viewModel.clearTransferMessage()
        }
    }

    Scaffold(
        containerColor = CourierCanvas,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(str(Strings.profile)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = str(Strings.back))
                    }
                },
                actions = {
                    IconButton(onClick = onNotificationsClick) {
                        Icon(Icons.Default.Notifications, contentDescription = "Уведомления")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = CourierSky,
                    titleContentColor = CourierInk,
                    navigationIconContentColor = CourierBlueDark,
                    actionIconContentColor = CourierBlueDark
                )
            )
        },
        bottomBar = {
            CourierBottomBar(
                selected = CourierTab.PROFILE,
                onHome = onBack,
                onOrders = onHistoryClick,
                onProfile = {}
            )
        }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(CourierCanvas)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item { Spacer(modifier = Modifier.height(4.dp)) }

            // Header: avatar + name + status
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(22.dp),
                    colors = CardDefaults.cardColors(containerColor = CourierSky),
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier.clickable(enabled = !state.isUploadingPhoto) {
                                photoPickerLauncher.launch(
                                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                                )
                            }
                        ) {
                            CourierAvatar(
                                photoBase64 = state.user?.photoBase64,
                                fallbackLetter = state.user?.name?.firstOrNull()?.uppercase()
                                    ?: str(Strings.courier).first().uppercase().toString(),
                                size = 96.dp,
                                letterStyle = MaterialTheme.typography.displaySmall
                            )

                            // Dim + spinner while uploading
                            if (state.isUploadingPhoto) {
                                Box(
                                    modifier = Modifier
                                        .size(96.dp)
                                        .clip(CircleShape)
                                        .background(Color.Black.copy(alpha = 0.45f)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    CircularProgressIndicator(
                                        color = Color.White,
                                        strokeWidth = 2.dp,
                                        modifier = Modifier.size(28.dp)
                                    )
                                }
                            }

                            // Camera edit badge
                            Box(
                                modifier = Modifier
                                    .align(Alignment.BottomEnd)
                                    .size(30.dp)
                                    .clip(CircleShape)
                                    .background(CourierBlue),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    Icons.Default.PhotoCamera,
                                    contentDescription = str(Strings.changePhoto),
                                    tint = Color.White,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = str(Strings.changePhoto),
                            style = MaterialTheme.typography.labelMedium,
                            color = CourierBlueDark,
                            modifier = Modifier.clickable(enabled = !state.isUploadingPhoto) {
                                photoPickerLauncher.launch(
                                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                                )
                            }
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = state.user?.name ?: str(Strings.courier),
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                            color = CourierInk
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(
                                        if (state.user?.isOnline == true) StatusOnline else StatusOffline
                                    )
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = if (state.user?.isOnline == true) str(Strings.online) else str(Strings.offline),
                                style = MaterialTheme.typography.bodyMedium,
                                color = CourierMuted
                            )
                        }

                        // Client rating (shown once the courier has ratings).
                        val ratingCount = state.user?.ratingCount ?: 0
                        if (ratingCount > 0) {
                            Spacer(modifier = Modifier.height(8.dp))
                            val rating = state.user?.rating ?: 0.0
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Default.Star,
                                    contentDescription = null,
                                    tint = Color(0xFFFFC107),
                                    modifier = Modifier.size(20.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = String.format(Locale.getDefault(), "%.1f", rating),
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = "($ratingCount)",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                                )
                            }
                        }
                    }
                }
            }

            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(22.dp))
                        .background(CourierHeroBrush)
                        .padding(20.dp)
                ) {
                    Text(
                        text = str(Strings.balance).uppercase(),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        color = Color.White.copy(alpha = 0.9f)
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = LocationUtils.formatCost(state.user?.balance ?: 0.0),
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                }
            }

            // Personal info
            item {
                SectionCard(title = str(Strings.personalInfo)) {
                    InfoRow(
                        icon = Icons.Default.Phone,
                        label = str(Strings.phoneNumber),
                        value = state.user?.phone?.takeIf { it.isNotBlank() } ?: str(Strings.notSpecified)
                    )
                    if (!state.user?.login.isNullOrBlank()) {
                        Divider(modifier = Modifier.padding(vertical = 4.dp), color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f))
                        InfoRow(
                            icon = Icons.Default.AccountCircle,
                            label = "Login",
                            value = state.user?.login ?: ""
                        )
                    }
                    if (state.user?.balanceTransferEnabled == true) {
                        Spacer(modifier = Modifier.height(12.dp))
                        Button(
                            onClick = {
                                selectedTransferRecipient = null
                                transferAmount = ""
                                showTransferDialog = true
                                viewModel.clearTransferMessage()
                                viewModel.loadTransferRecipients()
                            },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = (state.user?.balance ?: 0.0) >= 10.0
                        ) {
                            Icon(Icons.Default.SwapHoriz, contentDescription = null)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Перевести баланс")
                        }
                        if ((state.user?.balance ?: 0.0) < 10.0) {
                            Text(
                                text = "Для перевода на балансе должно быть не менее 10 сомони",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(top = 6.dp)
                            )
                        }
                    }
                }
            }

            // Statistics
            item {
                SectionCard(title = str(Strings.statistics)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        StatTile(
                            modifier = Modifier.weight(1f),
                            icon = Icons.Default.Today,
                            iconTint = AccentBlue,
                            title = str(Strings.today),
                            primary = "${state.todayDeliveries}",
                            secondary = LocationUtils.formatCost(state.todayEarnings)
                        )
                        StatTile(
                            modifier = Modifier.weight(1f),
                            icon = Icons.Default.CalendarMonth,
                            iconTint = AccentGreen,
                            title = str(Strings.allTime),
                            primary = "${state.totalDeliveries}",
                            secondary = LocationUtils.formatCost(state.totalEarnings)
                        )
                    }
                }
            }

            item {
                ProfileShortcut(Icons.Default.History, str(Strings.recentOrders), onHistoryClick)
            }
            item {
                ProfileShortcut(Icons.Default.CalendarMonth, str(Strings.byDays), onDaysClick)
            }
            item {
                ProfileShortcut(Icons.Default.ReceiptLong, "Комиссии и операции", onTransactionsClick)
            }

            item {
                SectionCard(title = str(Strings.settings)) {
                    Row(
                        modifier = Modifier.fillMaxWidth().clickable {
                            nightModeState.onChange(!nightModeState.enabled)
                        },
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.NightlightRound, contentDescription = null, tint = CourierBlueDark)
                        Spacer(modifier = Modifier.width(14.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(str(Strings.nightMode), fontWeight = FontWeight.SemiBold, color = CourierInk)
                            Text(
                                str(Strings.nightModeDescription),
                                style = MaterialTheme.typography.bodySmall,
                                color = CourierMuted
                            )
                        }
                        Switch(
                            checked = nightModeState.enabled,
                            onCheckedChange = nightModeState.onChange
                        )
                    }
                    Divider(modifier = Modifier.padding(vertical = 12.dp), color = CourierLine)
                    Row(
                        modifier = Modifier.fillMaxWidth().clickable { showLanguageDialog = true },
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Language, contentDescription = null, tint = CourierBlueDark)
                        Spacer(modifier = Modifier.width(14.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(str(Strings.changeLanguage), fontWeight = FontWeight.SemiBold, color = CourierInk)
                            Text(currentLanguage.displayName, style = MaterialTheme.typography.bodySmall, color = CourierMuted)
                        }
                        Icon(Icons.Default.ChevronRight, contentDescription = null, tint = CourierMuted)
                    }
                }
            }

            // Logout button
            item {
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedButton(
                    onClick = { showLogoutDialog = true },
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.5.dp, AccentRed),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = AccentRed)
                ) {
                    Icon(Icons.Default.Logout, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(str(Strings.logout), fontWeight = FontWeight.Bold)
                }
                Spacer(modifier = Modifier.height(24.dp))
            }
        }
    }

    if (showLanguageDialog) {
        LanguageDialog(
            currentLanguage = currentLanguage,
            onDismiss = { showLanguageDialog = false },
            onLanguageSelected = {
                (context as? android.app.Activity)?.recreate()
            }
        )
    }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            icon = { Icon(Icons.Default.Logout, contentDescription = null, tint = AccentRed) },
            title = { Text(str(Strings.logoutConfirmTitle)) },
            text = { Text(str(Strings.logoutConfirmMessage)) },
            confirmButton = {
                Button(
                    onClick = {
                        showLogoutDialog = false
                        viewModel.logout()
                        onLogout()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = AccentRed)
                ) {
                    Text(str(Strings.logout))
                }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutDialog = false }) {
                    Text(str(Strings.cancel))
                }
            }
        )
    }


    if (showTransferDialog) {
        AlertDialog(
            onDismissRequest = {
                if (!state.isTransferring) {
                    showTransferDialog = false
                    viewModel.clearTransferMessage()
                }
            },
            icon = { Icon(Icons.Default.SwapHoriz, contentDescription = null) },
            title = { Text("Перевод баланса") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = if (state.transferCity.isNotBlank()) {
                            "Доступны курьеры: ${state.transferCity}"
                        } else {
                            "Выберите курьера своего города"
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    when {
                        state.isLoadingTransferRecipients -> {
                            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        }
                        state.transferRecipients.isEmpty() && state.transferError == null -> {
                            Text(
                                text = "В вашем городе нет других доступных курьеров",
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        else -> {
                            ExposedDropdownMenuBox(
                                expanded = transferMenuExpanded,
                                onExpandedChange = {
                                    if (!state.isTransferring) transferMenuExpanded = !transferMenuExpanded
                                }
                            ) {
                                OutlinedTextField(
                                    value = selectedTransferRecipient?.let {
                                        if (it.phone.isBlank()) it.name else "${it.name} • ${it.phone}"
                                    } ?: "",
                                    onValueChange = {},
                                    readOnly = true,
                                    label = { Text("Курьер") },
                                    trailingIcon = {
                                        ExposedDropdownMenuDefaults.TrailingIcon(expanded = transferMenuExpanded)
                                    },
                                    modifier = Modifier
                                        .menuAnchor()
                                        .fillMaxWidth(),
                                    enabled = !state.isTransferring
                                )
                                ExposedDropdownMenu(
                                    expanded = transferMenuExpanded,
                                    onDismissRequest = { transferMenuExpanded = false }
                                ) {
                                    state.transferRecipients.forEach { recipient ->
                                        DropdownMenuItem(
                                            text = {
                                                Column {
                                                    Text(recipient.name)
                                                    if (recipient.phone.isNotBlank()) {
                                                        Text(
                                                            recipient.phone,
                                                            style = MaterialTheme.typography.bodySmall,
                                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                                        )
                                                    }
                                                }
                                            },
                                            onClick = {
                                                selectedTransferRecipient = recipient
                                                transferMenuExpanded = false
                                                viewModel.clearTransferMessage()
                                            }
                                        )
                                    }
                                }
                            }
                        }
                    }

                    OutlinedTextField(
                        value = transferAmount,
                        onValueChange = {
                            transferAmount = it.filter { char -> char.isDigit() || char == '.' || char == ',' }
                            viewModel.clearTransferMessage()
                        },
                        label = { Text("Сумма") },
                        suffix = { Text("сомони") },
                        supportingText = { Text("Минимум 10 сомони") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !state.isTransferring
                    )

                    Text(
                        text = "Доступно: ${LocationUtils.formatCost(state.user?.balance ?: 0.0)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    state.transferError?.let { error ->
                        Text(
                            text = error,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.transferBalance(
                            selectedTransferRecipient?.id.orEmpty(),
                            transferAmount
                        )
                    },
                    enabled = !state.isTransferring &&
                        !state.isLoadingTransferRecipients &&
                        selectedTransferRecipient != null &&
                        transferAmount.isNotBlank()
                ) {
                    if (state.isTransferring) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onPrimary
                        )
                    } else {
                        Text("Отправить")
                    }
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        showTransferDialog = false
                        viewModel.clearTransferMessage()
                    },
                    enabled = !state.isTransferring
                ) {
                    Text(str(Strings.cancel))
                }
            }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DailyStatsScreen(
    onBack: () -> Unit,
    viewModel: ProfileViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    Scaffold(
        containerColor = CourierCanvas,

        topBar = {
            TopAppBar(
                title = { Text(str(Strings.byDays)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = str(Strings.back))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = CourierSky,
                    titleContentColor = CourierInk,
                    navigationIconContentColor = CourierBlueDark
                )
            )
        }
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(paddingValues).padding(horizontal = 16.dp),
            contentPadding = PaddingValues(vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (state.isLoading) {
                item { CircularProgressIndicator() }
            } else if (state.dailyStats.isEmpty()) {
                item { Text(str(Strings.noDeliveries)) }
            } else {
                items(state.dailyStats, key = { it.dayStartMillis }) { day ->
                    DailyStatRow(day)
                }
            }
        }
    }
}
@Composable
private fun ProfileShortcut(icon: ImageVector, title: String, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = CourierSurface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, contentDescription = null, tint = CourierBlueDark)
            Spacer(modifier = Modifier.width(14.dp))
            Text(title, modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold, color = CourierInk)
            Icon(Icons.Default.ChevronRight, contentDescription = null, tint = CourierMuted)
        }
    }
}

@Composable
private fun SectionCard(
    title: String,
    content: @Composable ColumnScope.() -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = CourierSurface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = CourierInk
            )
            Spacer(modifier = Modifier.height(12.dp))
            content()
        }
    }
}

@Composable
private fun InfoRow(
    icon: ImageVector,
    label: String,
    value: String,
    valueColor: Color? = null
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = CourierBlueDark,
            modifier = Modifier.size(22.dp)
        )
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = CourierMuted
        )
        Spacer(modifier = Modifier.weight(1f))
        Text(
            text = value,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Bold,
            color = valueColor ?: CourierInk
        )
    }
}

@Composable
private fun StatTile(
    modifier: Modifier = Modifier,
    icon: ImageVector,
    iconTint: Color,
    title: String,
    primary: String,
    secondary: String
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = CourierCanvas),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = title,
                    style = MaterialTheme.typography.labelMedium,
                    color = CourierMuted
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    text = primary,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = CourierInk
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    text = str(Strings.deliveries).lowercase(),
                    style = MaterialTheme.typography.labelSmall,
                    color = CourierMuted,
                    modifier = Modifier.padding(bottom = 4.dp)
                )
            }
            Text(
                text = secondary,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = CourierBlueDark
            )
        }
    }
}

@Composable
private fun DailyStatRow(day: DailyStat) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.CalendarToday,
                contentDescription = null,
                tint = AccentBlue,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = SimpleDateFormat("dd MMMM yyyy", Locale.getDefault()).format(Date(day.dayStartMillis)),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    text = "${day.deliveryCount} • ${str(Strings.deliveries).lowercase()}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                )
            }
            Text(
                text = LocationUtils.formatCost(day.totalEarnings),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = AccentGreen
            )
        }
    }
}
