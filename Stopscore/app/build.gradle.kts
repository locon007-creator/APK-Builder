plugins { id("com.android.application") }

android {
    namespace = "com.stopscore.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.stopscore.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}
