package com.zaki.taksometr.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class GreetingTest {
    @Test
    fun convertsUtcTimeToDushanbeHour() {
        val clock = Clock.fixed(Instant.parse("2026-09-14T14:30:00Z"), ZoneOffset.UTC)
        assertEquals(19, Greeting.currentHour(clock))
        assertEquals("Добрый вечер", Greeting.forHour(Greeting.currentHour(clock))["ru"])
    }

    @Test
    fun selectsGreetingAtEveryBoundaryForAllLanguages() {
        val periods = listOf(
            4 to Strings.goodNight,
            5 to Strings.goodMorning,
            11 to Strings.goodMorning,
            12 to Strings.goodAfternoon,
            17 to Strings.goodAfternoon,
            18 to Strings.goodEvening,
            22 to Strings.goodEvening,
            23 to Strings.goodNight
        )
        for ((hour, expected) in periods) {
            for (language in listOf("tg", "ru", "en")) {
                assertNotNull("missing translation for $language", expected[language])
                assertEquals("hour=$hour language=$language", expected[language], Greeting.forHour(hour)[language])
            }
        }
    }
}
