package com.zaki.taksometr.util

import java.time.Clock
import java.time.ZoneId

object Greeting {
    private val dushanbeZone = ZoneId.of("Asia/Dushanbe")

    fun currentHour(clock: Clock = Clock.systemUTC()): Int =
        clock.instant().atZone(dushanbeZone).hour

    fun forHour(hour: Int): Map<String, String> = when (hour) {
        in 5..11 -> Strings.goodMorning
        in 12..17 -> Strings.goodAfternoon
        in 18..22 -> Strings.goodEvening
        else -> Strings.goodNight
    }
}
