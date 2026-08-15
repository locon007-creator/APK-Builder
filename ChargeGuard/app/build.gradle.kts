plugins { id("com.android.application") }

android {
    namespace = "com.chargeguard.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.chargeguard.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "1.1.0"
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}
