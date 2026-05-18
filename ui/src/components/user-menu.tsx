import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/auth-context'
import {
  LogOut,
  Settings,
  Palette,
  Check,
  Moon,
  Sun,
  Monitor,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { SidebarCustomizer } from './sidebar-customizer'
import { useAppearance } from '@/components/appearance-provider'
import { useTheme } from '@/components/theme-provider'
import type { ColorTheme } from '@/components/color-theme-provider'

const THEMES: { key: ColorTheme; label: string; swatch: string; dark?: boolean }[] = [
  { key: 'default',     label: 'Default',     swatch: '#6366f1' },
  { key: 'eye-care',    label: 'Eye Care',    swatch: '#7cb87c' },
  { key: 'darkmatter',  label: 'Dark Matter', swatch: '#e07b3d', dark: true },
  { key: 'notebook',    label: 'Notebook',    swatch: '#8b6914' },
  { key: 'clean-slate', label: 'Clean Slate', swatch: '#3b82f6' },
  { key: 'claude',      label: 'Claude',      swatch: '#c96442' },
  { key: 'darkpine',    label: 'Dark Pine',   swatch: '#3d7a3d', dark: true },
  { key: 'rose',        label: 'Rose',        swatch: '#e0527a' },
  { key: 'midnight',    label: 'Midnight',    swatch: '#4060c8', dark: true },
  { key: 'ocean',       label: 'Ocean',       swatch: '#1d9ba8', dark: true },
]

export function UserMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { colorTheme, setColorTheme } = useAppearance()
  const { theme, setTheme } = useTheme()
  const [themeDialogOpen, setThemeDialogOpen] = useState(false)

  if (!user) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative h-8 w-8 rounded-full">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user.avatar_url} alt={user.username} />
              <AvatarFallback>{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="end" forceMount>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{user.name || user.username}</p>
              <p className="text-xs leading-none text-muted-foreground">{user.username}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <SidebarCustomizer />
            <DropdownMenuItem onSelect={() => setThemeDialogOpen(true)}>
              <Palette className="mr-2 h-4 w-4" />
              <span>Themes</span>
            </DropdownMenuItem>
            {user?.isAdmin() && (
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => logout()}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>Log out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={themeDialogOpen} onOpenChange={setThemeDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Palette className="h-4 w-4" />
              Choose Theme
            </DialogTitle>
          </DialogHeader>

          {/* Light / Dark / Auto */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Mode</p>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                { value: 'light', label: 'Light', icon: Sun },
                { value: 'dark',  label: 'Dark',  icon: Moon },
                { value: 'system',label: 'Auto',  icon: Monitor },
              ] as const).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-lg border text-xs font-medium transition-colors
                    ${theme === value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:border-primary/50 hover:bg-accent text-muted-foreground'
                    }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Color themes */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Color Theme</p>
            <div className="grid grid-cols-2 gap-1.5">
              {THEMES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setColorTheme(t.key)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-sm transition-colors
                    ${colorTheme === t.key
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/40 hover:bg-accent'
                    }`}
                >
                  <span
                    className="h-4 w-4 rounded-full shrink-0 border border-black/10 dark:border-white/10"
                    style={{ backgroundColor: t.swatch }}
                  />
                  <span className="flex-1 text-left text-xs font-medium">{t.label}</span>
                  {t.dark && (
                    <span className="text-[9px] text-muted-foreground bg-muted px-1 py-0.5 rounded">dark</span>
                  )}
                  {colorTheme === t.key && (
                    <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-auto" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
