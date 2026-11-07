import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './app/Auth';
import { App } from './app/App';
import { RouteScroll } from './app/RouteScroll';
import './app/styles.css';
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <>
        <RouteScroll />
        <AuthProvider>
          <App />
        </AuthProvider>
      </>
    ),
  },
]);
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
