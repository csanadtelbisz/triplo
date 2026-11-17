import org.apache.tools.ant.taskdefs.condition.Os

plugins {
    id("com.android.application")
}

android {
    namespace = "io.github.csanadtelbisz.triplo"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.csanadtelbisz.triplo"
        minSdk = 26
        targetSdk = 36
        // CI passes the run number, which also orders the GitHub releases the app checks.
        versionCode = (project.findProperty("appVersionCode") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("appVersionName") as String?) ?: "0.0.0-dev"
    }

    // Release signing comes from the environment so no key is stored in the repository.
    // Updates only install over an app signed with the same key.
    val releaseKeystore = System.getenv("ANDROID_KEYSTORE_FILE")
    if (releaseKeystore != null) {
        signingConfigs.create("release") {
            storeFile = file(releaseKeystore)
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("ANDROID_KEY_ALIAS")
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (releaseKeystore != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addStaticSourceDirectory(
            layout.buildDirectory.dir("generated/web-assets").get().asFile.absolutePath
        )
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-ktx:1.11.0")
    implementation("androidx.webkit:webkit:1.15.0")
    implementation("androidx.exifinterface:exifinterface:1.4.1")
    implementation("com.google.android.gms:play-services-auth:22.0.0")
}

// Builds the unchanged web app with the native flag and the root base path,
// then places it in the APK assets under "web/". Pass -PskipWeb to reuse the
// previous output.
val webDir = rootDir.resolve("../frontend")
val webAssets = layout.buildDirectory.dir("generated/web-assets/web")
val npm = if (Os.isFamily(Os.FAMILY_WINDOWS)) "npm.cmd" else "npm"

val installWebDependencies = tasks.register<Exec>("installWebDependencies") {
    workingDir = webDir
    commandLine(npm, "ci")
    onlyIf { !project.hasProperty("skipWeb") && !webDir.resolve("node_modules").exists() }
}

val buildWeb = tasks.register<Exec>("buildWeb") {
    dependsOn(installWebDependencies)
    workingDir = webDir
    environment("VITE_TRIPLO_NATIVE", "android")
    commandLine(npm, "run", "build", "--", "--base=/", "--outDir=${webAssets.get().asFile.absolutePath}", "--emptyOutDir")
    inputs.dir(webDir.resolve("src"))
    inputs.dir(webDir.resolve("public"))
    inputs.dir(rootDir.resolve("../shared"))
    inputs.files(fileTree(rootDir.resolve("../climate")) { exclude("**/generated/**", "**/__pycache__/**") })
    inputs.file(webDir.resolve("index.html"))
    inputs.file(webDir.resolve("package-lock.json"))
    inputs.file(webDir.resolve("vite.config.ts"))
    inputs.property("nativeFlag", "android")
    outputs.dir(webAssets)
    onlyIf { !project.hasProperty("skipWeb") }
}

tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
    dependsOn(buildWeb)
}
