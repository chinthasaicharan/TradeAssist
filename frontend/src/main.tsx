import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './AuthContext'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        // Never retry 404s — ticker doesn't exist, retrying wastes requests
        if (error?.response?.status === 404) return false
        return failureCount < 1   // one retry for everything else
      },
      staleTime: 60_000,
      // No focus-refetch storms from stay-mounted sections — but errored
      // queries self-heal on the next window focus instead of stuck error UI
      refetchOnWindowFocus: (query) => query.state.status === 'error',
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
