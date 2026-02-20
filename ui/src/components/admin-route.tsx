import { ReactNode } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { Navigate, useLocation } from 'react-router-dom'

interface AdminRouteProps {
    children: ReactNode
}

export function AdminRoute({ children }: AdminRouteProps) {
    const { user, isLoading } = useAuth()
    const location = useLocation()

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
            </div>
        )
    }

    if (!user || !user.isAdmin()) {
        // Redirect to home or 403 page
        return <Navigate to="/" state={{ from: location }} replace />
    }

    return <>{children}</>
}
