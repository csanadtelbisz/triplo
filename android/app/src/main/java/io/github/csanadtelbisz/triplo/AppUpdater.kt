package io.github.csanadtelbisz.triplo

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInstaller
import android.app.AlertDialog
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.core.content.pm.PackageInfoCompat
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Checks the latest GitHub release and installs its APK through PackageInstaller.
 * Releases are tagged android-v<versionCode>. Android accepts the update only
 * when it is signed with the same key as the installed app.
 */
class AppUpdater(private val activity: ComponentActivity) {
    private class Release(
        val versionCode: Long,
        val name: String,
        val notes: String,
        val apkUrl: String,
        val sha256Url: String,
    )

    private val prefs = activity.getSharedPreferences("updater", Context.MODE_PRIVATE)
    private val executor = Executors.newSingleThreadExecutor()
    private var busy = false

    fun checkIfDue() {
        if (activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) return
        val now = System.currentTimeMillis()
        val due = now - prefs.getLong(KEY_LAST_CHECK, 0) > CHECK_INTERVAL_MS
        val resume = prefs.getBoolean(KEY_RESUME, false)
        if (busy || !(due || resume)) return
        busy = true
        prefs.edit().putBoolean(KEY_RESUME, false).apply()

        executor.execute {
            val release = try {
                fetchLatest().also { prefs.edit().putLong(KEY_LAST_CHECK, now).apply() }
            } catch (_: Exception) {
                null
            }
            onUi {
                if (release != null && release.versionCode > installedVersionCode()) prompt(release) else busy = false
            }
        }
    }

    private fun installedVersionCode(): Long =
        PackageInfoCompat.getLongVersionCode(activity.packageManager.getPackageInfo(activity.packageName, 0))

    private fun prompt(release: Release) {
        AlertDialog.Builder(activity)
            .setTitle("Update available")
            .setMessage("${release.name}\n\n${release.notes.take(MAX_NOTES_LENGTH)}".trim())
            .setPositiveButton("Update") { _, _ -> startUpdate(release) }
            .setNegativeButton("Later") { _, _ -> busy = false }
            .setOnCancelListener { busy = false }
            .show()
    }

    private fun startUpdate(release: Release) {
        if (!activity.packageManager.canRequestPackageInstalls()) {
            prefs.edit().putBoolean(KEY_RESUME, true).apply()
            AlertDialog.Builder(activity)
                .setTitle("Allow installing updates")
                .setMessage("Enable \"Allow from this source\" for Triplo on the next screen, then come back.")
                .setPositiveButton("Open settings") { _, _ ->
                    activity.startActivity(
                        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
                    )
                    busy = false
                }
                .setNegativeButton("Cancel") { _, _ -> busy = false }
                .setOnCancelListener { busy = false }
                .show()
            return
        }

        val progress = AlertDialog.Builder(activity)
            .setTitle("Downloading update")
            .setMessage("0%")
            .setCancelable(false)
            .show()

        executor.execute {
            try {
                val apk = download(release) { percent -> onUi { progress.setMessage("$percent%") } }
                onUi { progress.dismiss() }
                install(apk)
            } catch (e: Exception) {
                onUi {
                    progress.dismiss()
                    busy = false
                    AlertDialog.Builder(activity)
                        .setTitle("Update failed")
                        .setMessage(e.message ?: e.toString())
                        .setPositiveButton("OK", null)
                        .show()
                }
            }
        }
    }

    private fun fetchLatest(): Release? {
        val json = JSONObject(httpGet(LATEST_RELEASE_URL))
        val versionCode = TAG_PATTERN.matchEntire(json.getString("tag_name"))?.groupValues?.get(1)?.toLong() ?: return null
        val assets = json.getJSONArray("assets")
        var apkUrl: String? = null
        var sha256Url: String? = null
        for (i in 0 until assets.length()) {
            val asset = assets.getJSONObject(i)
            val name = asset.getString("name")
            val url = asset.getString("browser_download_url")
            if (name.endsWith(".apk")) apkUrl = url else if (name.endsWith(".apk.sha256")) sha256Url = url
        }
        if (apkUrl == null || sha256Url == null) return null
        return Release(
            versionCode,
            json.optString("name").ifEmpty { json.getString("tag_name") },
            json.optString("body"),
            apkUrl,
            sha256Url,
        )
    }

    private fun download(release: Release, onProgress: (Int) -> Unit): File {
        val directory = File(activity.cacheDir, "updates").apply {
            deleteRecursively()
            mkdirs()
        }
        val file = File(directory, "triplo-${release.versionCode}.apk")
        val digest = MessageDigest.getInstance("SHA-256")

        val connection = open(release.apkUrl)
        try {
            val total = connection.contentLengthLong
            var received = 0L
            var lastPercent = -1
            connection.inputStream.use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                        digest.update(buffer, 0, count)
                        received += count
                        val percent = if (total > 0) (received * 100 / total).toInt() else 0
                        if (percent != lastPercent) {
                            lastPercent = percent
                            onProgress(percent)
                        }
                    }
                }
            }
        } finally {
            connection.disconnect()
        }

        val expected = httpGet(release.sha256Url).trim().split(Regex("\\s+")).first().lowercase()
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        check(expected == actual) { "Downloaded file does not match its checksum." }
        return file
    }

    private fun install(apk: File) {
        val installer = activity.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setSize(apk.length())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            apk.inputStream().use { input ->
                session.openWrite("triplo.apk", 0, apk.length()).use { output ->
                    input.copyTo(output)
                    session.fsync(output)
                }
            }
            val result = PendingIntent.getBroadcast(
                activity,
                sessionId,
                Intent(activity, InstallResultReceiver::class.java).setPackage(activity.packageName),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            session.commit(result.intentSender)
        }
    }

    private fun open(url: String): HttpURLConnection {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 10_000
        connection.readTimeout = 30_000
        if (url == LATEST_RELEASE_URL) connection.setRequestProperty("Accept", "application/vnd.github+json")
        connection.setRequestProperty("User-Agent", "Triplo-Android")
        check(connection.responseCode == HttpURLConnection.HTTP_OK) { "Server answered ${connection.responseCode}" }
        return connection
    }

    private fun httpGet(url: String): String {
        val connection = open(url)
        try {
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    private fun onUi(block: () -> Unit) {
        activity.runOnUiThread {
            if (!activity.isFinishing && !activity.isDestroyed) block()
        }
    }

    private companion object {
        const val LATEST_RELEASE_URL = "https://api.github.com/repos/csanadtelbisz/triplo/releases/latest"
        val TAG_PATTERN = Regex("android-v(\\d+)")
        const val CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000L
        const val MAX_NOTES_LENGTH = 800
        const val KEY_LAST_CHECK = "lastCheck"
        const val KEY_RESUME = "resumeAfterPermission"
    }
}
