"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { UserRole } from "@/types/ticket";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  isUnauthenticatedAuthError,
  logIdentityReadFailure,
} from "@/lib/supabase/auth-read";
import { normalizeSelfServiceProfile } from "@/lib/profile/self-service";
import {
  assertClientMutationResponse,
  localizedClientMutationError,
} from "@/lib/http/client-mutation";

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  phone: string | null;
  avatar_url: string | null;
  status: string;
}

export default function ProfilePage() {
  const t = useTranslations("profile");
  const labels = useTranslations("labels");
  const locale = useLocale();
  const [supabase] = useState(() => createClient());
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Password change state
  const [changingPassword, setChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const authResult = await supabase.auth.getUser();
      const user = authResult.data.user;
      if (authResult.error && !isUnauthenticatedAuthError(authResult.error)) {
        logIdentityReadFailure("profile-page/auth", authResult.error);
        setLoadError(t("unavailable"));
        return;
      }
      if (!user) {
        setLoadError(t("sessionEnded"));
        return;
      }

      const profileResult = await supabase
        .from("users")
        .select("id, email, full_name, role, phone, avatar_url, status")
        .eq("id", user.id)
        .maybeSingle();
      if (profileResult.error) {
        logIdentityReadFailure("profile-page/profile", profileResult.error);
        setLoadError(t("unavailable"));
        return;
      }
      if (!profileResult.data || profileResult.data.status !== "active") {
        setLoadError(t("notAvailable"));
        return;
      }

      const data = profileResult.data as UserProfile;
      setProfile(data);
      setFullName(data.full_name || "");
      setPhone(data.phone || "");
    } catch (error) {
      logIdentityReadFailure("profile-page/unexpected", error);
      setLoadError(t("unavailable"));
    } finally {
      setLoading(false);
    }
  }, [supabase, t]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!profile || saving || changingPassword) return;
    const normalized = normalizeSelfServiceProfile({ fullName, phone });
    if (!normalized.success) {
      setMessage({ type: "error", text: t(`errors.${normalized.code}`) });
      return;
    }
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: normalized.data.fullName,
          phone: normalized.data.phone,
        }),
      });
      await assertClientMutationResponse(response, t("saveFailed"));
      setProfile({
        ...profile,
        full_name: normalized.data.fullName,
        phone: normalized.data.phone,
      });
      setFullName(normalized.data.fullName);
      setPhone(normalized.data.phone || "");
      setEditing(false);
      setMessage({ type: "success", text: t("saved") });
    } catch (error) {
      setMessage({
        type: "error",
        text: localizedClientMutationError(error, t("saveFailed"), locale),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(event: React.FormEvent) {
    event.preventDefault();
    if (changingPassword || saving) return;
    setPasswordMessage(null);

    if (!newPassword || newPassword.length < 12) {
      setPasswordMessage({
        type: "error",
        text: t("password.tooShort"),
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage({
        type: "error",
        text: t("password.mismatch"),
      });
      return;
    }

    setChangingPassword(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        logIdentityReadFailure("profile-page/password", error);
        setPasswordMessage({
          type: "error",
          text: t("password.failed"),
        });
        return;
      }
      setPasswordMessage({
        type: "success",
        text: t("password.updated"),
      });
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswords(false);
    } catch (error) {
      logIdentityReadFailure("profile-page/password-unexpected", error);
      setPasswordMessage({
        type: "error",
        text: t("password.failed"),
      });
    } finally {
      setChangingPassword(false);
    }
  }

  if (loading) {
    return (
      <div className="p-5 sm:p-8">
        <div className="max-w-2xl animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-muted" />
          <div className="h-64 rounded-xl bg-muted" />
        </div>
      </div>
    );
  }

  if (!profile || loadError) {
    return (
      <div className="p-5 sm:p-8">
        <div className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-5">
          <h1 className="text-lg font-semibold text-red-900">
            {t("loadFailedTitle")}
          </h1>
          <p className="mt-2 text-sm text-red-800">
            {loadError || t("unavailable")}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void loadProfile()}
              className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {t("tryAgain")}
            </button>
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
            >
              {t("signIn")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 sm:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      {message && (
        <div
          role={message.type === "error" ? "alert" : "status"}
          className={`mb-6 rounded-lg px-4 py-3 text-sm ${
            message.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="max-w-2xl space-y-6">
        {/* Avatar & Basic Info */}
        <section
          aria-labelledby="profile-details-heading"
          className="rounded-xl border border-border bg-white p-5 sm:p-6"
        >
          <div className="mb-6 flex min-w-0 items-center gap-4 sm:gap-6">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              {profile.avatar_url ? (
                <Image
                  src={profile.avatar_url}
                  alt={profile.full_name}
                  width={64}
                  height={64}
                  className="rounded-full"
                />
              ) : (
                <span className="text-2xl font-bold text-primary">
                  {profile.full_name?.charAt(0)?.toUpperCase() || "?"}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <h2
                id="profile-details-heading"
                className="truncate text-lg font-semibold text-foreground"
              >
                {profile.full_name}
              </h2>
              <p className="break-all text-sm text-muted-foreground">
                {profile.email}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-2 border-b border-border py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{t("email")}</p>
                <p className="break-all text-sm text-muted-foreground">
                  {profile.email}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t("emailManaged")}
              </span>
            </div>

            <div className="flex items-center justify-between gap-4 border-b border-border py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{t("role")}</p>
                <p className="text-sm text-muted-foreground">
                  {labels.has(`role.${profile.role}`) ? labels(`role.${profile.role}`) : profile.role}
                </p>
              </div>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  profile.status === "active"
                    ? "bg-green-100 text-green-800"
                    : "bg-gray-100 text-gray-800"
                }`}
              >
                {labels.has(`userStatus.${profile.status}`)
                  ? labels(`userStatus.${profile.status}`)
                  : profile.status}
              </span>
            </div>

            {editing ? (
              <form
                aria-busy={saving}
                onSubmit={handleSave}
                className="space-y-4"
              >
                <div>
                  <label
                    htmlFor="profile-full-name"
                    className="mb-1 block text-sm font-medium text-foreground"
                  >
                    {t("fullName")}
                  </label>
                  <input
                    id="profile-full-name"
                    type="text"
                    autoComplete="name"
                    maxLength={200}
                    required
                    disabled={saving || changingPassword}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                  />
                </div>
                <div>
                  <label
                    htmlFor="profile-phone"
                    className="mb-1 block text-sm font-medium text-foreground"
                  >
                    {t("phone")}
                  </label>
                  <input
                    id="profile-phone"
                    type="tel"
                    autoComplete="tel"
                    maxLength={50}
                    disabled={saving || changingPassword}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                  />
                </div>
                <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                  <button
                    type="submit"
                    disabled={saving || changingPassword}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
                  >
                    {saving ? t("saving") : t("save")}
                  </button>
                  <button
                    type="button"
                    disabled={saving || changingPassword}
                    onClick={() => {
                      setEditing(false);
                      setFullName(profile.full_name || "");
                      setPhone(profile.phone || "");
                      setMessage(null);
                    }}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                  >
                    {t("cancel")}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="flex items-center justify-between py-3 border-b border-border">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t("fullName")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {profile.full_name || t("notSet")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between py-3 border-b border-border">
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("phone")}</p>
                    <p className="text-sm text-muted-foreground">
                      {profile.phone || t("notSet")}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={changingPassword}
                  onClick={() => {
                    setEditing(true);
                    setMessage(null);
                  }}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  {t("edit")}
                </button>
              </>
            )}
          </div>
        </section>

        {/* Language: the switcher also saves the account preference used
            for emails. */}
        <section
          aria-labelledby="profile-language-heading"
          className="rounded-xl border border-border bg-white p-5 sm:p-6"
        >
          <h2
            id="profile-language-heading"
            className="text-base font-semibold text-foreground"
          >
            {t("language.title")}
          </h2>
          <p className="mt-1 mb-4 text-sm leading-6 text-muted-foreground">
            {t("language.body")}
          </p>
          <LanguageSwitcher />
        </section>

        {/* Change Password */}
        <section
          aria-labelledby="change-password-heading"
          className="rounded-xl border border-border bg-white p-5 sm:p-6"
        >
          <h2
            id="change-password-heading"
            className="text-base font-semibold text-foreground"
          >
            {t("password.title")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t("password.body")}
          </p>

          {passwordMessage && (
            <div
              role={passwordMessage.type === "error" ? "alert" : "status"}
              className={`mt-4 rounded-lg px-4 py-3 text-sm ${
                passwordMessage.type === "success"
                  ? "bg-green-50 text-green-800 border border-green-200"
                  : "bg-red-50 text-red-800 border border-red-200"
              }`}
            >
              {passwordMessage.text}
            </div>
          )}

          <form
            aria-busy={changingPassword}
            onSubmit={handleChangePassword}
            className="mt-5 space-y-4"
          >
            <div>
              <label
                htmlFor="profile-new-password"
                className="mb-1 block text-sm font-medium text-foreground"
              >
                {t("password.new")}
              </label>
              <input
                id="profile-new-password"
                type={showPasswords ? "text" : "password"}
                autoComplete="new-password"
                minLength={12}
                maxLength={1024}
                required
                disabled={changingPassword || saving}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t("password.newPlaceholder")}
                className="h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
              />
            </div>
            <div>
              <label
                htmlFor="profile-confirm-password"
                className="mb-1 block text-sm font-medium text-foreground"
              >
                {t("password.confirm")}
              </label>
              <input
                id="profile-confirm-password"
                type={showPasswords ? "text" : "password"}
                autoComplete="new-password"
                minLength={12}
                maxLength={1024}
                required
                disabled={changingPassword || saving}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t("password.confirmPlaceholder")}
                className="h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
              />
            </div>
            <button
              type="button"
              aria-pressed={showPasswords}
              disabled={changingPassword || saving}
              onClick={() => setShowPasswords((visible) => !visible)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              {showPasswords ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
              {showPasswords ? t("password.hide") : t("password.show")}
            </button>
            <button
              type="submit"
              disabled={changingPassword || saving}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 sm:w-auto"
            >
              {changingPassword ? t("password.submitting") : t("password.submit")}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
