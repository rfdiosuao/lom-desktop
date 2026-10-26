package top.heang.lom.pairing

/** R02 §2.1 reconnect schedule: 1 s, 2 s, 5 s, 10 s, then every 30 s, each with ±20 % jitter. */
object RelayBackoff {
    private val steps = longArrayOf(1_000, 2_000, 5_000, 10_000, 30_000)

    /** [jitter] in [-1, 1]; attempt counts from 0. */
    fun delayMillis(attempt: Int, jitter: Double): Long {
        val base = steps[attempt.coerceIn(0, steps.size - 1)]
        return (base * (1 + 0.2 * jitter.coerceIn(-1.0, 1.0))).toLong()
    }
}
