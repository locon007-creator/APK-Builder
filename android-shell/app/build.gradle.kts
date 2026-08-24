plugins {
    id("com.android.application")
}

val generatedAppId = providers.gradleProperty("APP_ID").orElse("com.apkbuilder.generated")
val generatedAppName = providers.gradleProperty("APP_NAME").orElse("Generated App")
val generatedVersionName = providers.gradleProperty("VERSION_NAME").orElse("1.0")
val generatedVersionCode = providers.gradleProperty("VERSION_CODE").orElse("1")
val generatedAssetsDir = providers.gradleProperty("WEB_ASSETS_DIR")

android {
    namespace = "com.apkbuilder.shell"
    compileSdk = 36

    defaultConfig {
        applicationId = generatedAppId.get()
        minSdk = 26
        targetSdk = 36
        versionCode = generatedVersionCode.get().toInt()
        versionName = generatedVersionName.get()
        manifestPlaceholders["appLabel"] = generatedAppName.get()
    }

    if (generatedAssetsDir.isPresent) {
        sourceSets.getByName("main").assets.setSrcDirs(listOf(file(generatedAssetsDir.get())))
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}
