// Analisis estatico (Practica 11, Fase 1): reglas recomendadas + seguridad + complejidad ciclomatica
const js = require('@eslint/js');
const security = require('eslint-plugin-security');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  security.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      complexity: ['warn', 8],
      'max-depth': ['warn', 3],
      'max-lines-per-function': ['warn', 60],
      'no-unused-vars': 'warn',
      'no-unreachable': 'error',
      'no-empty': 'warn',
      'require-await': 'warn',
      'no-console': 'off',
    },
  },
];
