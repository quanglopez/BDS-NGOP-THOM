import type { Config } from "tailwindcss";

/**
 * CheckBDS Design System v1.0 — token → Tailwind.
 *
 * Token gốc nằm ở `app/globals.css` (`:root`). File này chỉ alias chúng cho
 * utility class. Giá trị `DEFAULT` của navy / gold / cream giữ nguyên đúng như
 * trước để Phase 2 áp dụng từng component mà không đổi hình loạt.
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1200px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // --- Brand: navy ---
        // DEFAULT = #0B1D3A (giá trị cũ, chưa đổi) — dùng bởi 38 chỗ `bg-navy`.
        navy: {
          DEFAULT: "#0B1D3A",
          900: "#071B3A",
          800: "#0B2450",
          700: "#12305F",
          600: "#1C3F78",
        },

        // --- Brand: gold ---
        // DEFAULT = #C9A86A (giá trị cũ, chưa đổi) — dùng bởi 22 chỗ `bg-gold`.
        // `base` là gold CTA mới của Design System; Phase 2 mới chuyển CTA sang.
        gold: {
          DEFAULT: "#C9A86A",
          base: "#D8B46A",
          soft: "#E8CE96",
          deep: "#A9853C",
        },

        // --- Brand: cream (nền ấm cũ) ---
        cream: {
          DEFAULT: "#F8F7F4",
        },

        // --- Ink ---
        ink: {
          900: "#0B1220",
          700: "#2A3646",
          600: "#4B5B70",
          500: "#64748B",
          "on-navy": "#FFFFFF",
          "on-navy-muted": "#A9BBD4",
          "on-navy-faint": "#7E94B4",
        },

        // --- Surface ---
        surface: {
          DEFAULT: "#FFFFFF",
          mist: "#F6F8FB",
        },

        // --- Emerald: trạng thái AI. KHÔNG dùng cho CTA, link, icon điều hướng ---
        ai: {
          DEFAULT: "#10B981",
          ink: "#047857",
          wash: "#ECFDF5",
        },

        // --- Risk: luôn đi kèm icon + nhãn chữ, không chỉ bằng màu ---
        risk: {
          high: "#B42318",
          "high-wash": "#FEF3F2",
          medium: "#B54708",
          "medium-wash": "#FFFAEB",
          low: "#175CD3",
          "low-wash": "#EFF8FF",
          clear: "#047857",
          "clear-wash": "#ECFDF5",
        },

        // --- Line / border ---
        // Dùng rgb() có alpha sẵn: modifier dạng `/10` không áp dụng được cho
        // token đã chứa alpha. Dùng nguyên bản, không thêm opacity.
        line: {
          DEFAULT: "#D8E0EA",
          strong: "#7E8FA6",
          navy: "rgb(216 180 106 / 0.22)",
          "navy-strong": "rgb(216 180 106 / 0.42)",
        },

        // --- Focus ---
        focus: {
          light: "#0B2450",
          navy: "#D8B46A",
        },
      },

      // Ramp 7 bậc. Body 16px là sàn tuyệt đối cho text đọc được.
      fontSize: {
        display: [
          "clamp(2.125rem, 1.15rem + 5.2vw, 3.5rem)",
          { lineHeight: "1.08", letterSpacing: "-0.022em", fontWeight: "800" },
        ],
        h2: [
          "clamp(1.625rem, 1.15rem + 2.5vw, 2.5rem)",
          { lineHeight: "1.15", letterSpacing: "-0.018em", fontWeight: "800" },
        ],
        h3: [
          "clamp(1.125rem, 1.03rem + 0.5vw, 1.375rem)",
          { lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "700" },
        ],
        lead: [
          "clamp(1rem, 0.96rem + 0.2vw, 1.125rem)",
          { lineHeight: "1.65", fontWeight: "400" },
        ],
        body: ["1rem", { lineHeight: "1.65", fontWeight: "400" }],
        small: ["0.875rem", { lineHeight: "1.65", fontWeight: "400" }],
        micro: ["0.78125rem", { lineHeight: "1.45", fontWeight: "500", letterSpacing: "0.01em" }],
      },

      borderRadius: {
        sm: "var(--cb-radius-sm)",
        md: "var(--cb-radius-md)",
        lg: "var(--cb-radius-lg)",
        panel: "var(--cb-radius-panel)",
        pill: "var(--cb-radius-pill)",
      },

      boxShadow: {
        light: "var(--cb-shadow-light)",
        lift: "var(--cb-shadow-lift)",
        navy: "var(--cb-shadow-navy)",
      },

      transitionDuration: {
        micro: "160ms",
        base: "240ms",
        slow: "400ms",
        exit: "112ms",
      },

      transitionTimingFunction: {
        cb: "cubic-bezier(0.2, 0.7, 0.2, 1)",
        "cb-in": "cubic-bezier(0.5, 0, 0.9, 0.4)",
      },

      fontFamily: {
        sans: ["var(--cb-font-body)"],
        display: ["var(--cb-font-display)"],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
