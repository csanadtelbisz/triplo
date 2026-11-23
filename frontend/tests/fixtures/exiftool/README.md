# EXIF editing fixtures

Drop copies of real `.heic`, `.heif`, `.jpg`, `.jpeg`, `.png`, or `.webp` photos here to run the EXIF round-trip tests. The tests never modify the fixture files; they write the edited bytes to memory and verify the GPS values by reading them back.

Use photos you are comfortable testing with. The round-trip test writes a fixed test coordinate into its in-memory output.
