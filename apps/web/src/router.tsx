import { Link, Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { HandDetailPage } from "./routes/HandDetailPage.js";
import { HomePage } from "./routes/HomePage.js";
import { PlayPage } from "./routes/PlayPage.js";
import { SessionDetailPage } from "./routes/SessionDetailPage.js";
import { SessionsPage } from "./routes/SessionsPage.js";
import { TrainerPage } from "./routes/TrainerPage.js";

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-neutral-800 px-6 py-3 flex gap-6 items-center">
        <Link to="/" className="font-semibold text-lg">
          poker
        </Link>
        <nav className="flex gap-4 text-sm text-neutral-300">
          <Link to="/play" className="hover:text-white [&.active]:text-white">
            Play
          </Link>
          <Link to="/sessions" className="hover:text-white [&.active]:text-white">
            Sessions
          </Link>
          <Link to="/trainer" className="hover:text-white [&.active]:text-white">
            Trainer
          </Link>
        </nav>
      </header>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions",
  component: SessionsPage,
});

const sessionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions/$id",
  component: SessionDetailPage,
});

const handDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/hands/$id",
  component: HandDetailPage,
});

const trainerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/trainer",
  component: TrainerPage,
});

const playRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/play",
  component: PlayPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  sessionsRoute,
  sessionDetailRoute,
  handDetailRoute,
  trainerRoute,
  playRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
