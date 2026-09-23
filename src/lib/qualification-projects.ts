export type QualificationCategory = "FULL_STACK" | "DESIGNER" | "ECOMMERCE" | "CHAOS";

const names = [
  "SaaS Project Management", "CRM", "Invoicing SaaS", "Booking Application", "LMS",
  "Job Board", "Restaurant Reservation", "Inventory Management", "Expense Tracker", "Support Ticket System",
  "Social Community", "Event Management", "Real Estate", "Multi-role HR", "Document Management",
  "AI Chat Application", "Kanban", "Ecommerce", "API Integration Dashboard", "Complex Full-Stack SaaS",
  "Analytics Dashboard", "Customer Portal", "Appointment Scheduling", "Fitness Tracker", "Healthcare Appointment Administration",
  "Travel Booking", "Property Management", "Warehouse Operations", "Subscription Management", "Payment Administration",
  "CMS", "Blog Editor", "Knowledge Base", "Help Center", "Recruitment Pipeline", "Sales Pipeline",
  "Collaboration Workspace", "File Document Workflow", "Notification Center", "Audit Log Dashboard", "API Key Management",
  "Webhook Management", "Multi-Tenant Organization Platform", "RBAC Administration", "Customer Support Dashboard",
  "Client Portal", "Education Administration", "Marketing Campaign Dashboard", "Product Analytics", "Production B2B SaaS",
  "Premium SaaS Landing Page", "AI Startup Landing Page", "Developer Platform Landing Page", "Fintech Landing Page",
  "Design Agency Portfolio", "Creative Studio Portfolio", "Photographer Portfolio", "Architecture Portfolio", "Fashion Brand Website",
  "Luxury Hotel Website", "Startup Marketing Site", "Personal Portfolio", "Product Launch Page", "Typography Editorial Site",
  "Dark Mode Technology Landing Page", "Colorful Consumer Brand Landing Page", "Minimalist Portfolio", "Animated Agency Site",
  "Mobile First Startup Landing Page", "High End Designer Showcase", "Fashion Store", "Electronics Store", "Furniture Store",
  "Beauty Store", "Grocery Store", "Sneaker Store", "Luxury Fashion Store", "Jewelry Store", "Sports Equipment Store",
  "Home Decor Store", "Pet Store", "Baby Products Store", "Books Store", "Digital Products Store", "Subscription Box Store",
  "Multi-Vendor Marketplace", "Food Delivery Catalog", "Restaurant Ordering Store", "B2B Wholesale Store",
  "Complex Ecommerce Platform", "AI Travel Planner Booking Dashboard", "SaaS Marketplace Subscriptions",
  "Social Community Events Payments", "CRM Analytics Webhook Integration", "LMS Marketplace Multi-Role Auth",
  "Restaurant Delivery Loyalty", "Real Estate CRM Document Workflow", "Ecommerce AI Assistant Analytics",
  "Project Management Billing Collaboration", "Novel Operations Exchange",
] as const;

export function qualificationCategory(projectNumber: number): QualificationCategory {
  if (projectNumber <= 50) return "FULL_STACK";
  if (projectNumber <= 70) return "DESIGNER";
  if (projectNumber <= 90) return "ECOMMERCE";
  return "CHAOS";
}

export const QUALIFICATION_PROJECTS = names.map((name, index) => ({
  projectNumber: index + 1,
  name,
  category: qualificationCategory(index + 1),
}));

if (QUALIFICATION_PROJECTS.length !== 100) throw new Error("Qualification dashboard catalogue must contain 100 projects");
