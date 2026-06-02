import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// Get the base configurations from Next.js
const baseConfigs = compat.extends("next/core-web-vitals", "next/typescript");

// Define our custom rules
const customRules = {
  files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
  rules: {
    // Change unused vars to warnings, ignore vars starting with underscore
    "@typescript-eslint/no-unused-vars": [
      "warn", 
      { 
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "caughtErrorsIgnorePattern": "^_"
      }
    ],
    // Change namespace warning to warning instead of error
    "@typescript-eslint/no-namespace": "warn",
    // Change React hooks exhaustive deps to warning
    "react-hooks/exhaustive-deps": "warn"
  }
};

const eslintConfig = [
  ...baseConfigs,
  customRules
];

export default eslintConfig;