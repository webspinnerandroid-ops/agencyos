"use client"

import { useCallback, useEffect, useState, useTransition, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import {
  Loader2,
  Upload,
  Trash2,
  ExternalLink,
  Info,
  Palette,
  Globe,
  Image as ImageIcon,
} from "lucide-react"

import type { TenantSettings } from "./actions"
import {
  getTenantSettings,
  updateTenantSettings,
  uploadLogo,
  removeLogo,
} from "./actions"

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function WhiteLabelSettingsPage() {
  const [settings, setSettings] = useState<TenantSettings | null>(null)
  const [primaryColor, setPrimaryColor] = useState("#2563eb")
  const [customDomain, setCustomDomain] = useState("")
  const [feedback, setFeedback] = useState<{
    type: "success" | "error"
    message: string
  } | null>(null)
  const [isLoading, startLoading] = useTransition()
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------

  const loadSettings = useCallback(() => {
    startLoading(async () => {
      const res = await getTenantSettings()
      if (res.success && res.data) {
        setSettings(res.data)
        setPrimaryColor(res.data.primaryColor)
        setCustomDomain(res.data.customDomain ?? "")
      }
    })
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  const handleSaveColor = () => {
    startTransition(async () => {
      const res = await updateTenantSettings({ primaryColor })
      if (res.success) {
        setFeedback({
          type: "success",
          message: "Brand colour saved. Changes will appear on the next page load.",
        })
        loadSettings()
      } else {
        setFeedback({ type: "error", message: res.error ?? "Failed to save colour." })
      }
    })
  }

  const handleSaveDomain = () => {
    startTransition(async () => {
      const res = await updateTenantSettings({ customDomain })
      if (res.success) {
        setFeedback({ type: "success", message: "Custom domain saved." })
        loadSettings()
      } else {
        setFeedback({
          type: "error",
          message: res.error ?? "Failed to save domain.",
        })
      }
    })
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Read file as base64 data-URI
    const reader = new FileReader()
    reader.onload = async () => {
      startTransition(async () => {
        const base64 = reader.result as string
        const res = await uploadLogo(base64, file.name)
        if (res.success) {
          setFeedback({ type: "success", message: "Logo uploaded." })
          loadSettings()
        } else {
          setFeedback({
            type: "error",
            message: res.error ?? "Failed to upload logo.",
          })
        }
      })
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveLogo = () => {
    if (!confirm("Remove the current logo?")) return
    startTransition(async () => {
      const res = await removeLogo()
      if (res.success) {
        setFeedback({ type: "success", message: "Logo removed." })
        loadSettings()
      } else {
        setFeedback({
          type: "error",
          message: res.error ?? "Failed to remove logo.",
        })
      }
    })
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">White-Label Settings</h1>
        <p className="text-muted-foreground mt-1">
          Customise your client portal branding — logo, colour scheme, and
          custom domain.
        </p>
      </div>

      {/* Feedback toast */}
      {feedback && (
        <div
          className={`p-3 rounded-md text-sm font-medium ${
            feedback.type === "success"
              ? "bg-green-50 text-green-700 border border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800"
              : "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800"
          }`}
          role="alert"
        >
          {feedback.message}
          <button
            className="ml-3 underline text-xs"
            onClick={() => setFeedback(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ---- Logo Upload ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="size-5 text-primary" />
            Portal Logo
          </CardTitle>
          <CardDescription>
            Appears in the client portal header. Recommended size: 200×40 px
            (SVG or PNG). Leave blank to show your tenant name in plain text.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current logo preview */}
          {settings?.logoUrl ? (
            <div className="flex items-center gap-4">
              <img
                src={settings.logoUrl}
                alt="Current logo"
                className="h-10 w-auto object-contain border rounded-md p-1"
              />
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={handleRemoveLogo}
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    <Trash2 className="size-4" />
                    Remove
                  </>
                )}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-2">
              No logo uploaded —{" "}
              <strong>{settings?.name ?? "your tenant name"}</strong> will be
              displayed instead.
            </p>
          )}

          {/* Upload button */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/svg+xml,image/jpeg,image/webp"
              className="hidden"
              onChange={handleLogoUpload}
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="size-4" />
                  Upload Logo
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---- Primary Colour ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="size-5 text-primary" />
            Brand Colour
          </CardTitle>
          <CardDescription>
            The primary accent colour used for buttons, links, and interactive
            elements in the client portal. Choose a hex colour that matches your
            brand.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Colour preview swatch */}
            <div
              className="size-10 rounded-md border shadow-inner shrink-0"
              style={{ backgroundColor: primaryColor }}
              aria-label={`Colour preview: ${primaryColor}`}
            />

            {/* Colour input */}
            <div className="flex items-center gap-2">
              <Input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-14 h-10 p-1 cursor-pointer"
                disabled={isPending}
              />
              <Input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                placeholder="#2563eb"
                className="w-32 font-mono"
                disabled={isPending}
              />
            </div>

            {/* Preset colour chips */}
            <div className="flex items-center gap-1.5">
              {["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0f172a"].map(
                (color) => (
                  <button
                    key={color}
                    type="button"
                    className="size-7 rounded-full border-2 border-transparent hover:scale-110 transition-transform focus:outline-none focus:ring-2 focus:ring-ring"
                    style={{
                      backgroundColor: color,
                      borderColor:
                        primaryColor === color ? "var(--foreground)" : "transparent",
                    }}
                    onClick={() => setPrimaryColor(color)}
                    aria-label={`Set colour to ${color}`}
                    disabled={isPending}
                  />
                )
              )}
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleSaveColor}
            disabled={isPending || isLoading}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Colour"
            )}
          </Button>
        </CardFooter>
      </Card>

      {/* ---- Custom Domain ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="size-5 text-primary" />
            Custom Domain
          </CardTitle>
          <CardDescription>
            Serve the client portal on your own domain (e.g.{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              portal.yourdomain.com
            </code>
            ). After saving, complete the configuration on Vercel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customDomain">Domain Name</Label>
            <Input
              id="customDomain"
              type="text"
              placeholder="portal.yourdomain.com"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              Enter the domain without protocol (e.g.{" "}
              <code>portal.example.com</code>).
            </p>
          </div>

          {/* Configuration instructions */}
          <div className="rounded-md border bg-muted/30 p-4 space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <Info className="size-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">How to configure your custom domain</p>
                <p className="text-muted-foreground mt-1">
                  Custom domains are handled through Vercel's domain
                  management. This platform stores the domain you enter above and
                  maps it to your tenant, but manual Vercel configuration is
                  currently required.
                </p>
              </div>
            </div>

            <ol className="list-decimal pl-5 space-y-2 text-muted-foreground">
              <li>
                Save your domain above using the <strong>Save Domain</strong>{" "}
                button.
              </li>
              <li>
                In your Vercel dashboard, go to{" "}
                <strong>Settings → Domains</strong> for this project.
              </li>
              <li>
                Add your custom domain and follow the DNS verification steps
                Vercel provides.
              </li>
              <li>
                Once verified, Vercel automatically issues an SSL certificate
                and routes traffic to the platform.
              </li>
              <li>
                The platform reads the incoming hostname and maps it to the
                correct tenant via the <code>custom_domain</code> column.
              </li>
            </ol>

            <div className="flex items-center gap-2 pt-1">
              <ExternalLink className="size-3.5 text-muted-foreground" />
              <a
                href="https://vercel.com/docs/projects/domains"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline hover:no-underline text-xs"
              >
                Vercel Domains Documentation ↗
              </a>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleSaveDomain}
            disabled={isPending || isLoading}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Domain"
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}