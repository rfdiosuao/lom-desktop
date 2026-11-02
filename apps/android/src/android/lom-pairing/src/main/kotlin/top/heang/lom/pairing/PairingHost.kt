package top.heang.lom.pairing

/** Optional override on Application (tests, other hosts). Without it the built-in
 * [top.heang.lom.pairing.cloud.LomPairing] cloud adapter is used.
 * allowedHosts is a bundled allowlist, never taken from the scanned QR itself.
 */
interface PairingHost {
    val pairingAllowedHosts: Set<String>
    fun createPairingGateway(): PairingGateway
}
