import js from "@eslint/js"
import pluginNext from "@next/eslint-plugin-next"
import eslintConfigPrettier from "eslint-config-prettier"
import onlyWarn from "eslint-plugin-only-warn"
import pluginReact from "eslint-plugin-react"
import pluginReactHooks from "eslint-plugin-react-hooks"
import globals from "globals"
import tseslint from "typescript-eslint"

// Config única de la app. Antes vivía repartida entre
// `packages/eslint-config/{base,next}.js` y un `eslint.config.js` por paquete;
// con un solo paquete en el repo esa indirección no compraba nada.
/** @type {import("eslint").Linter.Config} */
export default [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    plugins: { onlyWarn },
  },
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.serviceworker,
      },
    },
  },
  {
    plugins: {
      "@next/next": pluginNext,
    },
    rules: {
      ...pluginNext.configs.recommended.rules,
      ...pluginNext.configs["core-web-vitals"].rules,
    },
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      // El nuevo transform de JSX no necesita React en scope.
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
  },
  {
    // Scripts de Node sueltos: corren con `node`, no en el bundle de Next, así
    // que `process` y compañía son globales legítimas.
    files: ["scripts/**/*.mjs", "*.mjs", "*.config.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    ignores: [
      "dist/**",
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "coverage/**",
      // Definiciones de agentes y skills instaladas, no código del producto.
      ".agents/**",
      ".claude/**",
      ".grok/**",
    ],
  },
]
