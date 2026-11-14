import java.util.Properties

plugins {
	id("com.android.application")
	id("org.jetbrains.kotlin.android")
}

val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties()
if (keystorePropertiesFile.exists()) {
	keystorePropertiesFile.inputStream().use { keystoreProperties.load(it) }
}

android {
	namespace = "dev.learnharness.app"
	compileSdk = 35

	defaultConfig {
		applicationId = "dev.learnharness.app"
		minSdk = 26
		targetSdk = 35
		versionCode = 4
		versionName = "0.6.3"
		val defaultServerUrl = (System.getenv("LH_ANDROID_DEFAULT_SERVER_URL") ?: (project.findProperty("lhDefaultServerUrl") as String?) ?: "").trim()
		buildConfigField("String", "DEFAULT_SERVER_URL", "\"" + defaultServerUrl + "\"")
	}

	buildFeatures {
		buildConfig = true
	}

	signingConfigs {
		create("release") {
			if (keystorePropertiesFile.exists()) {
				storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
				storePassword = keystoreProperties.getProperty("storePassword")
				keyAlias = keystoreProperties.getProperty("keyAlias")
				keyPassword = keystoreProperties.getProperty("keyPassword")
			}
		}
	}

	buildTypes {
		release {
			isMinifyEnabled = false
			signingConfig = if (keystorePropertiesFile.exists()) {
				signingConfigs.getByName("release")
			} else {
				signingConfigs.getByName("debug")
			}
		}
	}

	compileOptions {
		sourceCompatibility = JavaVersion.VERSION_17
		targetCompatibility = JavaVersion.VERSION_17
	}
	kotlinOptions {
		jvmTarget = "17"
	}
}

dependencies {
	implementation("androidx.appcompat:appcompat:1.7.0")
	implementation("androidx.activity:activity-ktx:1.9.3")
	implementation("androidx.core:core-ktx:1.15.0")
}
