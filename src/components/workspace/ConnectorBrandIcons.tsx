"use client";

import React from "react";

interface Props {
  id: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function ConnectorBrandIcon({ id, className = "", size = "md" }: Props) {
  const dim =
    size === "sm"
      ? "w-8 h-8 rounded-lg text-xs"
      : size === "lg"
      ? "w-11 h-11 rounded-xl text-base"
      : "w-9 h-9 rounded-lg text-sm";

  return (
    <div
      className={`shrink-0 flex items-center justify-center overflow-hidden ${dim} ${className}`}
      data-connector-icon={id}
    >
      {renderIcon(id)}
    </div>
  );
}

function renderIcon(id: string): React.ReactNode {
  switch (id) {
    case "google-search-console":
      return (
        <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
          <rect width="48" height="48" rx="10" fill="#ffffff" />
          <path d="M10 36V24l9-9 9 6 10-10v25H10z" fill="#E8EAED" />
          <path d="M10 36V27l9-6 9 6 10-12v21H10z" fill="#4285F4" />
          <path d="M10 36V30l9-3 9 5 10-9v13H10z" fill="#34A853" />
          <path d="M19 21l9 6 10-12" stroke="#FBBC04" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="38" cy="15" r="2.5" fill="#EA4335" />
          <circle cx="28" cy="27" r="2.5" fill="#FBBC04" />
          <circle cx="19" cy="21" r="2.5" fill="#34A853" />
          <circle cx="10" cy="36" r="2.5" fill="#4285F4" />
        </svg>
      );

    case "firecrawl":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#FF4500" />
          <path
            d="M18 6C18 6 13.5 12.5 13.5 18C13.5 21.7 15.8 24.5 19.1 24.5C16.9 22.2 16.9 20 18 17.8C19.1 15.5 21.4 13.3 21.4 10C23.6 12.8 24.8 16.7 24.8 20C24.8 25.6 20.8 30 15.8 30C10.7 30 6.8 26.1 6.8 20C6.8 12.2 12.4 7.8 18 6Z"
            fill="#FFA500"
          />
          <path
            d="M18 17.8C18 20.6 19.7 23.4 21.4 24.5C21.4 27.3 19.1 29 16.9 29C14.1 29 12.4 26.7 12.4 23.4C12.4 20 15.2 17.2 18 17.8Z"
            fill="#FFF5EE"
          />
        </svg>
      );

    case "google-sheets":
      return (
        <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
          <rect width="48" height="48" rx="10" fill="#ffffff" />
          <path d="M37 40H11C9.34 40 8 38.66 8 37V11C8 9.34 9.34 8 11 8H27L40 21V37C40 38.66 38.66 40 37 40Z" fill="#0F9D58" />
          <path d="M27 8V21H40L27 8Z" fill="#87CEAB" />
          <rect x="15" y="24" width="18" height="12" rx="1.5" fill="#FFFFFF" />
          <path d="M15 28H33M15 32H33M21 24V36M27 24V36" stroke="#0F9D58" strokeWidth="1.2" />
        </svg>
      );

    case "google-maps":
    case "google-maps-platform":
      return (
        <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
          <rect width="48" height="48" rx="10" fill="#ffffff" />
          <path
            d="M24 8C16.8 8 11 13.8 11 21C11 29.5 21.8 39.8 23.2 41.1C23.6 41.5 24.4 41.5 24.8 41.1C26.2 39.8 37 29.5 37 21C37 13.8 31.2 8 24 8Z"
            fill="#EA4335"
          />
          <path
            d="M24 14C27.9 14 31 17.1 31 21C31 24.9 27.9 28 24 28C20.1 28 17 24.9 17 21C17 17.1 20.1 14 24 14Z"
            fill="#ffffff"
          />
          <circle cx="24" cy="21" r="4.5" fill="#4285F4" />
          <path d="M24 8C16.8 8 11 13.8 11 21C11 24.2 12.2 27.1 14.2 29.3L24 19.5V8Z" fill="#4285F4" opacity="0.3" />
          <path d="M11 21C11 25.1 13.7 29.2 17.5 33L24 26.5V21H11Z" fill="#34A853" opacity="0.3" />
          <path d="M24 41.1C24.4 41.1 24.8 41.1 24.8 41.1C26.2 39.8 37 29.5 37 21H24V41.1Z" fill="#FBBC04" opacity="0.3" />
        </svg>
      );

    case "resend":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#000000" />
          <path
            d="M9 10H19C21.76 10 24 12.24 24 15C24 17.76 21.76 20 19 20H14V26H9V10Z"
            fill="#ffffff"
          />
          <path d="M19 20L25 26H19.5L14 20H19Z" fill="#ffffff" />
        </svg>
      );

    case "gmail":
      return (
        <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
          <rect width="48" height="48" rx="10" fill="#ffffff" />
          <path d="M10 34V16.5L24 26.5L38 16.5V34C38 35.1 37.1 36 36 36H12C10.9 36 10 35.1 10 34Z" fill="#EAEAEA" />
          <path d="M38 14V16.5L24 26.5L10 16.5V14C10 12.7 11.5 11.8 12.6 12.7L24 20.8L35.4 12.7C36.5 11.8 38 12.7 38 14Z" fill="#EA4335" />
          <path d="M10 14V34C10 35.1 10.9 36 12 36H16V18L10 14Z" fill="#4285F4" />
          <path d="M38 14V34C38 35.1 37.1 36 36 36H32V18L38 14Z" fill="#34A853" />
          <path d="M32 18L38 14L35.4 12.7L24 20.8L24 26.5L32 20.8V18Z" fill="#FBBC04" />
        </svg>
      );

    case "google-drive":
      return (
        <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
          <rect width="48" height="48" rx="10" fill="#ffffff" />
          <path d="M18 12L8 30H19.5L29.5 12H18Z" fill="#0066DA" />
          <path d="M19.5 30L24.8 39H39.5L34.2 30H19.5Z" fill="#00AC47" />
          <path d="M29.5 12L39.5 30H34.2L24.2 12H29.5Z" fill="#EA4335" opacity="0.1" />
          <path d="M29.5 12L40 30.5L34.5 39L24 20.5L29.5 12Z" fill="#FFBA00" />
        </svg>
      );

    case "google-calendar":
      return (
        <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
          <rect width="48" height="48" rx="10" fill="#ffffff" />
          <rect x="9" y="11" width="30" height="26" rx="4" fill="#4285F4" />
          <path d="M9 11H39V18H9V11Z" fill="#1973E8" />
          <rect x="15" y="7" width="3.5" height="5.5" rx="1.5" fill="#4285F4" />
          <rect x="29.5" y="7" width="3.5" height="5.5" rx="1.5" fill="#4285F4" />
          <text
            x="24"
            y="31"
            fontFamily="system-ui, -apple-system, sans-serif"
            fontSize="13"
            fontWeight="bold"
            fill="#ffffff"
            textAnchor="middle"
          >
            31
          </text>
        </svg>
      );

    case "telegram":
      return (
        <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
          <circle cx="24" cy="24" r="22" fill="#229ED9" />
          <path
            d="M13 23.5L35 14L30 32C29.7 33.3 28.9 33.6 27.8 33L22 28.7L19.2 31.4C18.9 31.7 18.6 32 18 32L18.4 26.2L29 16.6C29.5 16.2 28.9 15.9 28.3 16.3L15.2 24.5L9.6 22.8C8.4 22.4 8.4 21.6 9.8 21L13 23.5Z"
            fill="#ffffff"
          />
        </svg>
      );

    case "elevenlabs":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#000000" />
          <rect x="12" y="10" width="4" height="16" rx="2" fill="#ffffff" />
          <rect x="20" y="10" width="4" height="16" rx="2" fill="#ffffff" />
        </svg>
      );

    case "notion":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#ffffff" />
          <path
            d="M9 10.5L22.5 8.2C24.2 7.9 25 8.6 25 10.4V24.5C25 26.2 24.1 27.4 22.4 27.6L11.2 28.8C9.9 28.9 9 28.4 9 26.8V10.5Z"
            fill="#000000"
          />
          <path
            d="M12.8 13.2L18.8 22V12.8H21.2V23.8L15.2 15V24.2H12.8V13.2Z"
            fill="#ffffff"
          />
        </svg>
      );

    case "google-docs":
      return (
        <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
          <rect width="48" height="48" rx="10" fill="#ffffff" />
          <path d="M37 40H11C9.34 40 8 38.66 8 37V11C8 9.34 9.34 8 11 8H27L40 21V37C40 38.66 38.66 40 37 40Z" fill="#4285F4" />
          <path d="M27 8V21H40L27 8Z" fill="#A1C2FA" />
          <rect x="15" y="24" width="18" height="2" rx="1" fill="#FFFFFF" />
          <rect x="15" y="28.5" width="18" height="2" rx="1" fill="#FFFFFF" />
          <rect x="15" y="33" width="12" height="2" rx="1" fill="#FFFFFF" />
        </svg>
      );

    case "slack":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#ffffff" />
          <path d="M9.5 16C9.5 14.9 10.4 14 11.5 14H13.5V16C13.5 17.1 12.6 18 11.5 18C10.4 18 9.5 17.1 9.5 16Z" fill="#E01E5A" />
          <path d="M15.5 10C15.5 11.1 14.6 12 13.5 12V10C13.5 8.9 14.4 8 15.5 8C16.6 8 17.5 8.9 17.5 10V14H15.5V10Z" fill="#E01E5A" />
          <path d="M19.5 10C19.5 8.9 20.4 8 21.5 8C22.6 8 23.5 8.9 23.5 10V12H21.5C20.4 12 19.5 11.1 19.5 10Z" fill="#36C5F0" />
          <path d="M25.5 16C24.4 16 23.5 15.1 23.5 14H25.5C26.6 14 27.5 14.9 27.5 16C27.5 17.1 26.6 18 25.5 18H21.5V16H25.5Z" fill="#36C5F0" />
          <path d="M25.5 19.5C25.5 20.6 24.6 21.5 23.5 21.5H21.5V19.5C21.5 18.4 22.4 17.5 23.5 17.5C24.6 17.5 25.5 18.4 25.5 19.5Z" fill="#2EB67D" />
          <path d="M19.5 25.5C19.5 24.4 20.4 23.5 21.5 23.5V25.5C21.5 26.6 20.6 27.5 19.5 27.5C18.4 27.5 17.5 26.6 17.5 25.5V21.5H19.5V25.5Z" fill="#2EB67D" />
          <path d="M15.5 25.5C15.5 26.6 14.6 27.5 13.5 27.5C12.4 27.5 11.5 26.6 11.5 25.5V23.5H13.5C14.6 23.5 15.5 24.4 15.5 25.5Z" fill="#ECB22E" />
          <path d="M9.5 19.5C10.6 19.5 11.5 20.4 11.5 21.5H9.5C8.4 21.5 7.5 20.6 7.5 19.5C7.5 18.4 8.4 17.5 9.5 17.5H13.5V19.5H9.5Z" fill="#ECB22E" />
        </svg>
      );

    case "hubspot":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#FF7A59" />
          <circle cx="23.5" cy="12.5" r="3.2" fill="#ffffff" />
          <circle cx="12.5" cy="23.5" r="3.2" fill="#ffffff" />
          <circle cx="18" cy="18" r="4.2" fill="none" stroke="#ffffff" strokeWidth="2.4" />
          <path d="M18 9V13.5M18 22.5V27M9 18H13.5M22.5 18H27" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );

    case "google-slides":
      return (
        <svg viewBox="0 0 48 48" className="w-full h-full" fill="none">
          <rect width="48" height="48" rx="10" fill="#ffffff" />
          <path d="M37 40H11C9.34 40 8 38.66 8 37V11C8 9.34 9.34 8 11 8H27L40 21V37C40 38.66 38.66 40 37 40Z" fill="#FBBC04" />
          <path d="M27 8V21H40L27 8Z" fill="#FFE082" />
          <rect x="15" y="24" width="18" height="12" rx="1.5" fill="#FFFFFF" />
          <rect x="17.5" y="26.5" width="13" height="7" rx="0.5" fill="#FBBC04" opacity="0.6" />
        </svg>
      );

    case "perplexity":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#141E28" />
          <path d="M18 7V29M7 18H29M10 10L26 26M26 10L10 26" stroke="#22B8CD" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="18" cy="18" r="3.5" fill="#22B8CD" />
        </svg>
      );

    case "supabase":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#1C1C1C" />
          <path
            d="M19.5 6L8.5 19H17.5L16.5 30L27.5 17H18.5L19.5 6Z"
            fill="#3ECF8E"
          />
        </svg>
      );

    case "amazon-s3":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#232F3E" />
          <path d="M10 12L18 7.5L26 12V24L18 28.5L10 24V12Z" fill="#FF9900" />
          <path d="M18 7.5V28.5M10 12L18 16.5L26 12" stroke="#232F3E" strokeWidth="1.6" />
        </svg>
      );

    case "stripe":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#635BFF" />
          <path
            d="M16 15.5C16 14.7 16.8 14.1 18 14.1C19.5 14.1 21.2 14.6 22.5 15.4V11.2C21 10.6 19.4 10.3 17.8 10.3C13.8 10.3 11.2 12.3 11.2 15.8C11.2 21.4 19.2 20.5 19.2 23.2C19.2 24.2 18.2 24.7 16.8 24.7C15.2 24.7 13.3 24 11.7 23.1V27.5C13.5 28.2 15.3 28.5 17.1 28.5C21.2 28.5 24 26.5 24 22.8C24 16.9 16 17.8 16 15.5Z"
            fill="#ffffff"
          />
        </svg>
      );

    case "shopify":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#95BF47" />
          <path
            d="M21 9C21 9 18.8 9.2 17.6 10.4C16.5 11.5 16.2 13.5 16.2 13.5L12.5 15L9.8 27.5L26.2 27.5L26.2 13.5L21 9Z"
            fill="#ffffff"
            opacity="0.2"
          />
          <path d="M21 13.5H15C15 13.5 15.3 10.2 18 10.2C20.8 10.2 21 13.5 21 13.5Z" stroke="#ffffff" strokeWidth="2" />
          <path d="M10.5 15L12 27H24L25.5 15H10.5Z" fill="#ffffff" />
          <path
            d="M18 17.5C16.8 17.5 16 18.3 16 19.3C16 21 19.8 20.5 19.8 22.3C19.8 23 19 23.5 18 23.5C16.8 23.5 16 23 16 23V24.5C16 24.5 16.8 25 18 25C19.8 25 21.2 23.8 21.2 22C21.2 20 17.5 20.5 17.5 19C17.5 18.5 18 18.3 18.6 18.3C19.3 18.3 20 18.5 20 18.5V17C20 17 19.2 16.8 18 16.8V17.5Z"
            fill="#95BF47"
          />
        </svg>
      );

    case "woocommerce":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#7F54B3" />
          <path
            d="M10 13C10 11.3 11.3 10 13 10H23C24.7 10 26 11.3 26 13V21C26 22.7 24.7 24 23 24H15L11 27V24C10.4 24 10 23.6 10 23V13Z"
            fill="#ffffff"
          />
          <text
            x="18"
            y="19"
            fontFamily="system-ui, sans-serif"
            fontSize="8"
            fontWeight="900"
            fill="#7F54B3"
            textAnchor="middle"
          >
            WOO
          </text>
        </svg>
      );

    case "chargebee":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#FF6844" />
          <circle cx="15" cy="18" r="5" stroke="#ffffff" strokeWidth="2.5" />
          <circle cx="21" cy="18" r="5" stroke="#ffffff" strokeWidth="2.5" />
        </svg>
      );

    case "xero":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <circle cx="18" cy="18" r="18" fill="#13B5EA" />
          <text
            x="18"
            y="22"
            fontFamily="system-ui, sans-serif"
            fontSize="12"
            fontWeight="bold"
            fill="#ffffff"
            textAnchor="middle"
          >
            xero
          </text>
        </svg>
      );

    case "wix":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#0C6EFC" />
          <text
            x="18"
            y="23"
            fontFamily="system-ui, sans-serif"
            fontSize="11"
            fontWeight="900"
            letterSpacing="1"
            fill="#ffffff"
            textAnchor="middle"
          >
            WIX
          </text>
        </svg>
      );

    case "polar":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#2463EB" />
          <polygon points="18,8 21,15 28,18 21,21 18,28 15,21 8,18 15,15" fill="#ffffff" />
        </svg>
      );

    case "replicate":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#000000" />
          <rect x="9" y="10" width="18" height="3" fill="#ffffff" />
          <rect x="9" y="16.5" width="12" height="3" fill="#ffffff" />
          <rect x="9" y="23" width="6" height="3" fill="#ffffff" />
        </svg>
      );

    case "gemini-enterprise":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#ffffff" />
          <path
            d="M18 6C18 12.6 12.6 18 6 18C12.6 18 18 23.4 18 30C18 23.4 23.4 18 30 18C23.4 18 18 12.6 18 6Z"
            fill="url(#gemini-grad)"
          />
          <defs>
            <linearGradient id="gemini-grad" x1="6" y1="6" x2="30" y2="30" gradientUnits="userSpaceOnUse">
              <stop stopColor="#1B73E8" />
              <stop offset="0.5" stopColor="#7B1FA2" />
              <stop offset="1" stopColor="#D93025" />
            </linearGradient>
          </defs>
        </svg>
      );

    case "n8n":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#EA4B71" />
          <circle cx="11" cy="18" r="3" fill="#ffffff" />
          <circle cx="25" cy="12" r="3" fill="#ffffff" />
          <circle cx="25" cy="24" r="3" fill="#ffffff" />
          <path d="M14 18L22 13M14 18L22 23" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );

    case "custom-mcp":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#6554E8" />
          <rect x="11" y="11" width="14" height="14" rx="3" stroke="#ffffff" strokeWidth="2" />
          <path d="M15 15L19 18L15 21" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="20" y1="21" x2="22" y2="21" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );

    case "algolia":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <circle cx="18" cy="18" r="18" fill="#003DFF" />
          <circle cx="17" cy="17" r="6" stroke="#ffffff" strokeWidth="2.2" fill="none" />
          <line x1="21.5" y1="21.5" x2="26" y2="26" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );

    case "google-analytics":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#ffffff" />
          <rect x="22" y="10" width="5" height="16" rx="2.5" fill="#E37400" />
          <rect x="15" y="15" width="5" height="11" rx="2.5" fill="#F9AB00" />
          <circle cx="11.5" cy="23.5" r="2.5" fill="#E37400" />
        </svg>
      );

    case "amplitude":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#1A66FF" />
          <path d="M10 23L15 13L21 21L26 13" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case "posthog":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#F54E00" />
          <circle cx="18" cy="18" r="8" fill="#ffffff" />
          <circle cx="15.5" cy="16.5" r="1.5" fill="#F54E00" />
          <circle cx="20.5" cy="16.5" r="1.5" fill="#F54E00" />
          <path d="M16 20.5C17 21.5 19 21.5 20 20.5" stroke="#F54E00" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case "twilio":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <circle cx="18" cy="18" r="18" fill="#F22F46" />
          <circle cx="13" cy="18" r="2.4" fill="#ffffff" />
          <circle cx="18" cy="13" r="2.4" fill="#ffffff" />
          <circle cx="23" cy="18" r="2.4" fill="#ffffff" />
          <circle cx="18" cy="23" r="2.4" fill="#ffffff" />
        </svg>
      );

    case "firebase-fcm":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#ffffff" />
          <path d="M10 26L14 8L18 16L10 26Z" fill="#FFA000" />
          <path d="M18 16L21 11L26 26L18 16Z" fill="#F57C00" />
          <path d="M10 26L18 21L26 26L18 30L10 26Z" fill="#FFCA28" />
        </svg>
      );

    case "mailgun":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#F06B26" />
          <rect x="9" y="12" width="18" height="13" rx="2" stroke="#ffffff" strokeWidth="2" />
          <path d="M9 13.5L18 20L27 13.5" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );

    case "salesforce":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#00A1E0" />
          <path
            d="M13 22C11.3 22 10 20.7 10 19C10 17.5 11.1 16.3 12.5 16.1C13 14.3 14.7 13 16.6 13C17.7 13 18.8 13.5 19.5 14.3C20.3 13.5 21.4 13 22.5 13C24.4 13 26 14.5 26.2 16.3C26.7 16.6 27 17.3 27 18C27 19.1 26.1 20 25 20C24.8 20 24.6 20 24.4 19.9C24 21.1 22.8 22 21.5 22H13Z"
            fill="#ffffff"
          />
        </svg>
      );

    case "logo-dev":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#18181B" />
          <text
            x="18"
            y="22"
            fontFamily="system-ui, sans-serif"
            fontSize="10"
            fontWeight="bold"
            fill="#ffffff"
            textAnchor="middle"
          >
            logo.dev
          </text>
        </svg>
      );

    case "microsoft":
    case "microsoft-365":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#ffffff" />
          <rect x="9" y="9" width="8" height="8" fill="#F25022" />
          <rect x="19" y="9" width="8" height="8" fill="#7FBA00" />
          <rect x="9" y="19" width="8" height="8" fill="#00A4EF" />
          <rect x="19" y="19" width="8" height="8" fill="#FFB900" />
        </svg>
      );

    case "microsoft-teams":
      return (
        <svg viewBox="0 0 36 36" className="w-full h-full" fill="none">
          <rect width="36" height="36" rx="8" fill="#464EB8" />
          <rect x="10" y="10" width="16" height="16" rx="3" fill="#ffffff" />
          <text
            x="18"
            y="22"
            fontFamily="system-ui, sans-serif"
            fontSize="11"
            fontWeight="900"
            fill="#464EB8"
            textAnchor="middle"
          >
            T
          </text>
        </svg>
      );

    default:
      return (
        <div className="w-full h-full flex items-center justify-center bg-zinc-800 text-white font-bold text-xs">
          {id.slice(0, 2).toUpperCase()}
        </div>
      );
  }
}
