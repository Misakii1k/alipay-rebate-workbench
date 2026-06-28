using System;
using System.Diagnostics;
using System.IO;

class AsWrapper
{
    static int Main(string[] args)
    {
        string exeDir = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);

        // Find gcc in the self-contained directory (NOT in our wrapper directory)
        string selfContained = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            @".rustup\toolchains\stable-x86_64-pc-windows-gnu\lib\rustlib\x86_64-pc-windows-gnu\bin\self-contained");

        string gcc = Path.Combine(selfContained, "x86_64-w64-mingw32-gcc.exe");
        if (!File.Exists(gcc))
        {
            gcc = Path.Combine(selfContained, "gcc.exe");
        }
        if (!File.Exists(gcc))
        {
            Console.Error.WriteLine("as_wrapper: gcc not found in self-contained directory: " + selfContained);
            return 1;
        }

        // Translate arguments: dlltool passes --64, --32, --x32 etc.
        // gcc doesn't understand these; translate to -m64, -m32, -mx32
        var translated = new System.Collections.Generic.List<string>();
        bool hasInputFile = false;

        foreach (string arg in args)
        {
            if (arg == "--64")
                translated.Add("-m64");
            else if (arg == "--32")
                translated.Add("-m32");
            else if (arg == "--x32")
                translated.Add("-mx32");
            else if (arg == "--no-leading-underscore" || arg == "--leading-underscore")
            {
                // skip - gcc handles this differently
            }
            else if (arg.StartsWith("--") || arg.StartsWith("-"))
            {
                // Pass through other flags
                translated.Add(arg);
            }
            else
            {
                // Input file
                hasInputFile = true;
                translated.Add(arg);
            }
        }

        if (!hasInputFile)
        {
            // No input file - nothing to do, success
            return 0;
        }

        // Build gcc arguments: -c -x assembler <translated args>
        // -c: compile (don't link)
        // -x assembler: treat input as assembly language
        var allArgs = new System.Collections.Generic.List<string>();
        allArgs.Add("-c");
        allArgs.Add("-x");
        allArgs.Add("assembler");
        allArgs.AddRange(translated);

        // CRITICAL: Remove our wrapper directory from PATH so gcc doesn't find us
        // when it looks for 'as'. This prevents infinite recursion.
        string currentPath = Environment.GetEnvironmentVariable("PATH") ?? "";
        var pathParts = new System.Collections.Generic.List<string>();
        foreach (string part in currentPath.Split(';'))
        {
            if (!string.IsNullOrEmpty(part) &&
                !string.Equals(part.TrimEnd('\\').TrimEnd('/'), exeDir.TrimEnd('\\').TrimEnd('/'),
                    StringComparison.OrdinalIgnoreCase))
            {
                pathParts.Add(part);
            }
        }

        // Also add -pipe flag to use pipes instead of temp files (avoids some as invocations)
        allArgs.Add("-pipe");

        var argParts = new System.Collections.Generic.List<string>();
        foreach (var a in allArgs)
        {
            if (a.Contains(" ") || a.Contains("\t"))
                argParts.Add("\"" + a + "\"");
            else
                argParts.Add(a);
        }

        var psi = new ProcessStartInfo
        {
            FileName = gcc,
            Arguments = string.Join(" ", argParts),
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        // Set PATH without our directory to prevent recursion
        psi.EnvironmentVariables["PATH"] = string.Join(";", pathParts);

        using (var proc = Process.Start(psi))
        {
            string stdout = proc.StandardOutput.ReadToEnd();
            string stderr = proc.StandardError.ReadToEnd();
            proc.WaitForExit();
            if (!string.IsNullOrEmpty(stdout))
                Console.Out.Write(stdout);
            if (!string.IsNullOrEmpty(stderr))
                Console.Error.Write(stderr);
            return proc.ExitCode;
        }
    }
}
