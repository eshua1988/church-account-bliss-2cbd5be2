import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import PublicPayout from "./pages/PublicPayout";
import PublicTransactions from "./pages/PublicTransactions";
import SignaturePad from "./pages/SignaturePad";
import BankCallback from "./pages/BankCallback";
import PublicDeposit from "./pages/PublicDeposit";

const queryClient = new QueryClient();

// Apply system theme on initial load
function ThemeInitializer() {
  useEffect(() => {
    const saved = localStorage.getItem('theme');
    const root = document.documentElement;
    
    if (saved === 'light' || saved === 'dark') {
      root.classList.add(saved);
    } else {
      // Use system preference
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.add(isDark ? 'dark' : 'light');
    }
  }, []);
  
  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeInitializer />
    <TooltipProvider>
      <AuthProvider>
        <LanguageProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter basename={import.meta.env.BASE_URL}>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/payout/:token" element={<PublicPayout />} />
              <Route path="/deposit/:token" element={<PublicDeposit />} />
              <Route path="/transactions/:token" element={<PublicTransactions />} />
              <Route path="/sign" element={<SignaturePad />} />
              <Route 
                path="/" 
                element={
                  <ProtectedRoute>
                    <Index />
                  </ProtectedRoute>
                } 
              />
              <Route path="/bank-callback" element={<BankCallback />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </LanguageProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
