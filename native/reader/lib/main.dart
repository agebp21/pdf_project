import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_windows/webview_windows.dart' as windows;

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  if (Platform.isAndroid) {
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  }
  runApp(const BookApp());
}

class BookApp extends StatelessWidget {
  const BookApp({super.key});
  @override
  Widget build(BuildContext context) => const MaterialApp(
    title: 'Sarvamaya Flipbook', debugShowCheckedModeBanner: false,
    home: BookScreen(),
  );
}

class BookScreen extends StatefulWidget {
  const BookScreen({super.key});
  @override
  State<BookScreen> createState() => _BookScreenState();
}

class _BookScreenState extends State<BookScreen> {
  WebViewController? android;
  windows.WebviewController? desktop;
  bool ready = false;
  String? failure;

  @override
  void initState() { super.initState(); initialize(); }

  Future<void> initialize() async {
    try {
      if (Platform.isWindows) {
        if (await windows.WebviewController.getWebViewVersion() == null) {
          throw Exception('Microsoft Edge WebView2 Runtime belum terpasang. Pasang runtime tersebut lalu buka aplikasi kembali.');
        }
        final controller = windows.WebviewController();
        desktop = controller;
        await controller.initialize();
        await controller.setBackgroundColor(const Color(0xffe8ece8));
        final file = File('${File(Platform.resolvedExecutable).parent.path}/data/flutter_assets/assets/book/index.html');
        if (!await file.exists()) { throw Exception('Aset buku tidak ditemukan. Ekstrak seluruh ZIP bersama folder data.'); }
        await controller.loadUrl(file.uri.toString());
      } else if (Platform.isAndroid) {
        final controller = WebViewController();
        android = controller;
        await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
        await controller.setBackgroundColor(const Color(0xffe8ece8));
        await controller.setNavigationDelegate(NavigationDelegate(
          onNavigationRequest: (request) => request.url.startsWith('file:///android_asset/')
            ? NavigationDecision.navigate : NavigationDecision.prevent,
          onWebResourceError: (error) {
            if (error.isForMainFrame == true && mounted) {
              setState(() { failure = 'Buku gagal dimuat: ${error.description}'; });
            }
          },
        ));
        await controller.loadFlutterAsset('assets/book/index.html');
      } else {
        throw Exception('Aplikasi ini mendukung Android dan Windows.');
      }
      if (mounted) { setState(() { ready = true; }); }
    } catch (error) {
      if (mounted) { setState(() { failure = error.toString(); }); }
    }
  }

  @override
  void dispose() { desktop?.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xffe8ece8),
    body: SafeArea(child: failure != null
      ? Center(child: Padding(padding: const EdgeInsets.all(24), child: SelectableText(failure!, textAlign: TextAlign.center)))
      : !ready ? const Center(child: CircularProgressIndicator())
      : Platform.isWindows ? windows.Webview(desktop!) : WebViewWidget(controller: android!)),
  );
}
