// Precarga para perfilar: permite que --cpu-prof escriba el archivo al terminar con SIGTERM.
process.on('SIGTERM', () => process.exit(0));
