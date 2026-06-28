using System;
using System.Diagnostics;
using System.IO;

class AsWrapper
{
    static int Main(string[] args)
    {
        // Resolve the directory where this as.exe is located
        string exeDir = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);

        // Find the real gcc in the same directory
        string gcc = Path.Combine(exeDir, "x86_64-w64-mingw32-gcc.exe");
        if (!File.Exists(gcc))
        {
            // Fallback: try without the prefix
            gcc = Path.Combine(exeDir, "gcc.exe");
        }

        // Translate arguments:
        // --64 -> -m64 (or just skip, since gcc is already 64-bit)
        // --32 -> -m32
        // --x32 -> -mx32
        // Keep -o, -I, -D flags as-is
        var translated = new System.Collections.Generic.List<string>();
        bool hasInputFile = false;

        foreach (string arg in args)
        {
            if (arg == "--64")
            {
                translated.Add("-m64");
            }
            else if (arg == "--32")
            {
                translated.Add("-m32");
            }
            else if (arg == "--x32")
            {
                translated.Add("-mx32");
            }
            else if (arg == "--no-leading-underscore")
            {
                // This is an `as` flag that gcc doesn't understand; skip it
            }
            else if (arg == "--leading-underscore")
            {
                // Also skip; gcc handles this via -fleading-underscore but it's not needed here
            }
            else if (arg.StartsWith("-"))
            {
                // Pass through other flags (like -o)
                translated.Add(arg);
            }
            else
            {
                // This is likely the input file (.s)
                hasInputFile = true;
                translated.Add(arg);
            }
        }

        // Build the final command: gcc -c -x assembler [translated args]
        var allArgs = new System.Collections.Generic.List<string>();
        allArgs.Add("-c");
        allArgs.Add("-x");
        allArgs.Add("assembler");
        allArgs.AddRange(translated);

        // If no input file was specified, add /dev/null equivalent (stdin)
        if (!hasInputFile)
        {
            // dlltool usually passes the input file, but just in case
        }

        // Build argument string (quote args that contain spaces)
        var argParts = new System.Collections.Generic.List<string>();
        foreach (var a in allArgs)
        {
            if (a.Contains(" "))
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

        using (var proc = Process.Start(psi))
        {
            string stdout = proc.StandardOutput.ReadToEnd();
            string stderr = proc.StandardError.ReadToEnd();
            proc.WaitForExit();

            // Forward output
            if (!string.IsNullOrEmpty(stdout))
                Console.Out.Write(stdout);
            if (!string.IsNullOrEmpty(stderr))
                Console.Error.Write(stderr);

            return proc.ExitCode;
        }
    }
}
