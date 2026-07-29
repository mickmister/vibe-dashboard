import formatjs from "eslint-plugin-formatjs";
import globals from "globals";
import tseslint from "typescript-eslint";

const translatableObjectProperties = [
  "ariaLabel",
  "caption",
  "emptyContent",
  "errorMessage",
  "helperText",
  "label",
  "message",
  "placeholder",
  "subtitle",
  "title",
  "tooltip",
];

export default [
  {
    ignores: [
      ".git/**",
      "dist/**",
      "node_modules/**",
      "storybook-static/**",
      "src/i18n/compiled/**",
    ],
  },
  {
    files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        sourceType: "module",
      },
    },
    plugins: {
      formatjs,
    },
    rules: {
      ...formatjs.configs.recommended.rules,
      "formatjs/enforce-description": ["error", "literal"],
      "formatjs/enforce-default-message": ["error", "literal"],
      "formatjs/no-id": "error",
      "formatjs/no-literal-string-in-jsx": [
        "error",
        {
          props: {
            include: [
              ["*", "aria-{label,description,details,errormessage}"],
              ["*", "{label,description,helperText,errorMessage,title,tooltip,placeholder,emptyContent}"],
              ["[a-z]*([a-z0-9])", "{placeholder,title}"],
              ["img", "alt"],
            ],
            exclude: [["FormattedMessage", "description"]],
          },
        },
      ],
      "formatjs/no-literal-string-in-object": [
        "error",
        {
          include: translatableObjectProperties,
        },
      ],
    },
  },
];
