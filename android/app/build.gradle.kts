import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.process.ExecOperations
import javax.inject.Inject

// Builds the web app with the native flag and the root base path into <assetsDirectory>/web.
// Declaring the assets directory as an output lets every task that reads the assets, such as
// lint, depend on this one.
abstract class BuildWebTask @Inject constructor(private val execOperations: ExecOperations) : DefaultTask() {
    @get:Internal
    abstract val webDirectory: DirectoryProperty

    @get:OutputDirectory
    abstract val assetsDirectory: DirectoryProperty

    @get:Input
    abstract val npmCommand: Property<String>

    @TaskAction
    fun build() {
        val output = assetsDirectory.get().asFile.resolve("web")
        execOperations.exec {
            workingDir = webDirectory.get().asFile
            environment("VITE_TRIPLO_NATIVE", "android")
            commandLine(npmCommand.get(), "run", "build", "--", "--base=/", "--outDir=${output.absolutePath}", "--emptyOutDir")
        }
    }
}

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
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
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

dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-ktx:1.11.0")
    implementation("androidx.webkit:webkit:1.15.0")
    implementation("androidx.exifinterface:exifinterface:1.4.1")
    implementation("com.google.android.gms:play-services-auth:22.0.0")
}

// Builds the unchanged web app with the native flag and the root base path, then places it in
// the APK assets under "web/". Pass -PskipWeb to reuse the previous output.
val webDir = rootDir.resolve("../frontend")
val npm = if (Os.isFamily(Os.FAMILY_WINDOWS)) "npm.cmd" else "npm"

val installWebDependencies = tasks.register<Exec>("installWebDependencies") {
    workingDir = webDir
    commandLine(npm, "ci")
    onlyIf { !project.hasProperty("skipWeb") && !webDir.resolve("node_modules").exists() }
}

val buildWeb = tasks.register<BuildWebTask>("buildWeb") {
    dependsOn(installWebDependencies)
    webDirectory.set(webDir)
    assetsDirectory.set(layout.buildDirectory.dir("generated/web-assets"))
    npmCommand.set(npm)
    inputs.dir(webDir.resolve("src"))
    inputs.dir(webDir.resolve("public"))
    inputs.dir(rootDir.resolve("../shared"))
    inputs.files(fileTree(rootDir.resolve("../climate")) { exclude("**/generated/**", "**/__pycache__/**") })
    inputs.file(webDir.resolve("index.html"))
    inputs.file(webDir.resolve("package-lock.json"))
    inputs.file(webDir.resolve("vite.config.ts"))
    onlyIf { !project.hasProperty("skipWeb") }
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(buildWeb, BuildWebTask::assetsDirectory)
    }
}
