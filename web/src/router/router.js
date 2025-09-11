import { createRouter, createWebHistory } from "vue-router";

const routes = [
  {
    path: "/",
    component: () => import("@/pages/HomeScreen"),
    name: "Home",
  },
  {
    path: "/:gameCode([A-Z]{5})/draw",
    component: () => import("@/pages/TakeTurn"),
    name: "TakeTurn",
  },
  // Game code (5 case insensitive letters) sends users to waiting room
  {
    path: "/:gameCode([A-Z]{5})/review",
    component: () => import("@/pages/Review"),
    name: "Review",
  },
  // Game code (5 case insensitive letters) sends users to waiting room
  {
    path: "/:gameCode([A-Z]{5})",
    component: () => import("@/pages/WaitingRoom"),
    name: "WaitingRoom",
  },
  {
    path: '/:pathMatch(.*)*',
    component: () => import("@/pages/PageNotFound"),
    name: "PageNotFound",
  },
];

const router = createRouter({
  history: createWebHistory('/'), // base path also needs to be changed in /vite.config.mjs
  routes
});

export default router;
