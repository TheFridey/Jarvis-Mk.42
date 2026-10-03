plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "uk.co.jarvis.companion"
    compileSdk = 35
    defaultConfig { applicationId = "uk.co.jarvis.companion"; minSdk = 29; targetSdk = 35; versionCode = 1; versionName = "0.1.0" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies { implementation("com.squareup.okhttp3:okhttp:4.12.0") }
