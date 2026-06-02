// Horizon 极简布局 —— 逐步替换 MainLayout

import { Outlet } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function HorizonLayout() {
    return (
        <TooltipProvider delayDuration={300}>
            <div className="flex flex-col h-full w-full bg-background text-foreground">
                <Outlet />
            </div>
            <Toaster position="top-center" richColors />
        </TooltipProvider>
    );
}
