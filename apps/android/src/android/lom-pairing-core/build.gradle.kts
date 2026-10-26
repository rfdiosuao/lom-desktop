plugins { id("org.jetbrains.kotlin.jvm") }
kotlin { jvmToolchain(17) }
dependencies {
    implementation("com.google.crypto.tink:tink-android:1.8.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    // Reads the shared R01 vectors (copied from bundled protocol vectors).
    testImplementation("org.json:json:20240303")
}
