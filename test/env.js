// Variables mínimas para poder importar los módulos del servidor en las pruebas.
process.env.SESSION_SECRET ||= 'prueba-prueba-prueba-prueba-prueba-12345';
process.env.NODE_ENV ||= 'test';
