package dev.learnharness.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
	private lateinit var webView: WebView
	private lateinit var setup: View
	private lateinit var urlField: EditText
	private var pendingPermission: PermissionRequest? = null

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		setContentView(R.layout.activity_main)
		webView = findViewById(R.id.web)
		setup = findViewById(R.id.setup)
		urlField = findViewById(R.id.server_url)
		findViewById<Button>(R.id.connect).setOnClickListener { saveAndOpen() }
		configureWebView()
		onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
			override fun handleOnBackPressed() {
				if (setup.visibility == View.VISIBLE) {
					if (savedUrl() != null) showWeb() else finish()
					return
				}
				if (webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
			}
		})
		val saved = savedUrl()
		if (saved == null) showSetup() else open(saved)
	}

	@SuppressLint("SetJavaScriptEnabled")
	private fun configureWebView() {
		webView.settings.apply {
			javaScriptEnabled = true
			domStorageEnabled = true
			mediaPlaybackRequiresUserGesture = false
			mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
			userAgentString = "$userAgentString LearnHarnessAndroid/${BuildConfig.VERSION_NAME}"
		}
		CookieManager.getInstance().setAcceptCookie(true)
		CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)
		webView.addJavascriptInterface(AndroidBridge(), "LearnHarnessAndroid")
		webView.webViewClient = object : WebViewClient() {
			override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
				val target = request.url
				if (target.scheme != "http" && target.scheme != "https") return true
				val allowed = savedUrl()?.let { Uri.parse(it).host }
				if (allowed != null && target.host == allowed) return false
				startActivity(Intent(Intent.ACTION_VIEW, target))
				return true
			}
		}
		webView.webChromeClient = object : WebChromeClient() {
			override fun onPermissionRequest(request: PermissionRequest) {
				val audio = request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
				if (!audio) {
					request.deny()
					return
				}
				if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
					request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
				} else {
					pendingPermission = request
					ActivityCompat.requestPermissions(this@MainActivity, arrayOf(Manifest.permission.RECORD_AUDIO), AUDIO_REQUEST)
				}
			}
		}
	}

	override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
		super.onRequestPermissionsResult(requestCode, permissions, grantResults)
		if (requestCode != AUDIO_REQUEST) return
		val request = pendingPermission
		pendingPermission = null
		if (request == null) return
		if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
			request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
		} else {
			request.deny()
		}
	}

	private fun prefs() = getSharedPreferences(PREFS, MODE_PRIVATE)

	private fun savedUrl(): String? = prefs().getString(SERVER_URL, null)?.takeIf { it.isNotBlank() }
		?: BuildConfig.DEFAULT_SERVER_URL.takeIf { it.isNotBlank() }

	private fun showSetup() {
		setup.visibility = View.VISIBLE
		webView.visibility = View.GONE
		urlField.setText(savedUrl().orEmpty())
		urlField.requestFocus()
	}

	private fun showWeb() {
		setup.visibility = View.GONE
		webView.visibility = View.VISIBLE
	}

	private fun saveAndOpen() {
		val parsed = parseUrl(urlField.text.toString())
		if (parsed == null) {
			urlField.error = "Enter an http or https URL"
			return
		}
		val previous = savedUrl()
		if (previous != null && Uri.parse(previous).host != Uri.parse(parsed).host) {
			CookieManager.getInstance().removeAllCookies(null)
		}
		prefs().edit().putString(SERVER_URL, parsed).apply()
		webView.loadUrl(parsed)
		showWeb()
	}

	private fun open(url: String) {
		showWeb()
		if (webView.url != url) webView.loadUrl(url)
	}

	private fun parseUrl(raw: String): String? {
		val text = raw.trim()
		val uri = Uri.parse(text)
		if (uri.scheme != "http" && uri.scheme != "https") return null
		if (uri.host.isNullOrBlank()) return null
		if (!uri.userInfo.isNullOrBlank()) return null
		return text
	}

	private inner class AndroidBridge {
		@android.webkit.JavascriptInterface
		fun openServerSettings() {
			runOnUiThread { showSetup() }
		}
	}

	companion object {
		private const val PREFS = "learnharness"
		private const val SERVER_URL = "server_url"
		private const val AUDIO_REQUEST = 1
	}
}
