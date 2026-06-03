import { Suspense } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import Pools from "@/pages/pools";
import { LoadingSkeleton } from "./components/loading";
import HorizonLayout from "./layouts/horizon-layout";
import { lazyWithReload } from "./utils/lazy";

const Wizard = lazyWithReload(() => import("@/pages/wizard"));
const Progress = lazyWithReload(() => import("@/pages/progress"));
const PoolDetail = lazyWithReload(() => import("@/pages/pool-detail"));
const Calendar = lazyWithReload(() => import("@/pages/calendar"));

function RootRoute() {
    return (
        <Routes>
            <Route element={<HorizonLayout />}>
                <Route index element={<Pools />} />
                <Route
                    path="/wizard"
                    element={
                        <Suspense fallback={<LoadingSkeleton />}>
                            <Wizard />
                        </Suspense>
                    }
                />
                <Route
                    path="/progress/:goalId"
                    element={
                        <Suspense fallback={<LoadingSkeleton />}>
                            <Progress />
                        </Suspense>
                    }
                />
                <Route
                    path="/pool/:id"
                    element={
                        <Suspense fallback={<LoadingSkeleton />}>
                            <PoolDetail />
                        </Suspense>
                    }
                />
                <Route
                    path="/calendar"
                    element={
                        <Suspense fallback={<LoadingSkeleton />}>
                            <Calendar />
                        </Suspense>
                    }
                />
            </Route>
        </Routes>
    );
}

export default function Rooot() {
    return (
        <MemoryRouter>
            <RootRoute />
        </MemoryRouter>
    );
}
