// MyFlipbook book launcher: ONE .exe that carries the whole Windows reader
// (Flutter runtime, WebView2 loader, the sealed book) as a ZIP appended to
// this program. The first run unpacks it into
// %LOCALAPPDATA%\MyFlipbook\Books\<id>\ and every run starts the reader
// from there. Built by server.py with the .NET Framework compiler that
// ships with Windows (C# 5), so the book needs nothing else installed.
//
// Trailer (last 120 bytes): "MFBOOK01", payload offset (int64), payload
// length (int64), 32-char id (ASCII), reader exe name (UTF-8, zero padded).
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Windows.Forms;

static class Launcher
{
    const string Magic = "MFBOOK01";
    const int TrailerSize = 120;

    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            string self = Process.GetCurrentProcess().MainModule.FileName;
            string root, exeName;
            using (FileStream file = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                byte[] trailer = new byte[TrailerSize];
                file.Seek(-TrailerSize, SeekOrigin.End);
                ReadAll(file, trailer, TrailerSize);
                if (Encoding.ASCII.GetString(trailer, 0, 8) != Magic)
                    throw new InvalidDataException("This book file is damaged: its content is missing. Download it again.");
                long offset = BitConverter.ToInt64(trailer, 8), length = BitConverter.ToInt64(trailer, 16);
                string id = Encoding.ASCII.GetString(trailer, 24, 32);
                exeName = Encoding.UTF8.GetString(trailer, 56, 64).TrimEnd('\0');
                if (offset < 0 || length <= 0 || offset + length > file.Length - TrailerSize || exeName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                    throw new InvalidDataException("This book file is damaged. Download it again.");
                root = Path.Combine(Path.Combine(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MyFlipbook"), "Books"), id);
                if (!File.Exists(Path.Combine(root, ".ready")))
                    Unpack(file, offset, length, root, id);
            }
            ProcessStartInfo start = new ProcessStartInfo(Path.Combine(root, exeName));
            start.WorkingDirectory = root;
            start.UseShellExecute = false;
            Process.Start(start);
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "MyFlipbook", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    // Unpack next to the final folder, then move it into place, so a run that
    // is interrupted never leaves a half-unpacked book behind.
    static void Unpack(FileStream file, long offset, long length, string root, string id)
    {
        string temp = root + ".unpacking-" + Process.GetCurrentProcess().Id;
        if (Directory.Exists(temp)) Directory.Delete(temp, true);
        Directory.CreateDirectory(temp);
        byte[] payload = new byte[length];
        file.Seek(offset, SeekOrigin.Begin);
        ReadAll(file, payload, payload.Length);
        using (ZipArchive zip = new ZipArchive(new MemoryStream(payload), ZipArchiveMode.Read))
        {
            string full = Path.GetFullPath(temp) + Path.DirectorySeparatorChar;
            foreach (ZipArchiveEntry entry in zip.Entries)
            {
                string target = Path.GetFullPath(Path.Combine(temp, entry.FullName));
                if (!target.StartsWith(full, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("This book file is damaged. Download it again.");
                if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using (Stream source = entry.Open())
                using (FileStream output = new FileStream(target, FileMode.Create, FileAccess.Write))
                    source.CopyTo(output);
            }
        }
        File.WriteAllText(Path.Combine(temp, ".ready"), id);
        try
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
            Directory.Move(temp, root);
        }
        catch (IOException)
        {
            // Another copy of the book finished unpacking first: use that one.
            if (!File.Exists(Path.Combine(root, ".ready"))) throw;
            try { Directory.Delete(temp, true); } catch (IOException) { }
        }
    }

    static void ReadAll(Stream stream, byte[] buffer, int count)
    {
        int read = 0;
        while (read < count)
        {
            int n = stream.Read(buffer, read, count - read);
            if (n <= 0) throw new EndOfStreamException("This book file is incomplete. Download it again.");
            read += n;
        }
    }
}
