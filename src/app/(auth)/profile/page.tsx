"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";
import Link from "next/link";
import type { UserRole } from "@/types/ticket";
import { ROLE_LABELS } from "@/lib/roles";
import {
  isUnauthenticatedAuthError,
  logIdentityReadFailure,
} from "@/lib/supabase/auth-read";
import {
  normalizeSelfServiceProfile,
  PASSWORD_UPDATE_ERROR_MESSAGE,
  PROFILE_UPDATE_ERROR_MESSAGE,
} from "@/lib/profile/self-service";

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
        setLoadError("Account data is temporarily unavailable. Please retry.");
        return;
      }
      if (!user) {
        setLoadError("Your session has ended. Please sign in again.");
        return;
      }

      const profileResult = await supabase
        .from("users")
        .select("id, email, full_name, role, phone, avatar_url, status")
        .eq("id", user.id)
        .maybeSingle();
      if (profileResult.error) {
        logIdentityReadFailure("profile-page/profile", profileResult.error);
        setLoadError("Account data is temporarily unavailable. Please retry.");
        return;
      }
      if (!profileResult.data || profileResult.data.status !== "active") {
        setLoadError("This account is not available.");
        return;
      }

      const data = profileResult.data as UserProfile;
      setProfile(data);
      setFullName(data.full_name || "");
      setPhone(data.phone || "");
    } catch (error) {
      logIdentityReadFailure("profile-page/unexpected", error);
      setLoadError("Account data is temporarily unavailable. Please retry.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  async function handleSave() {
    if (!profile) return;
    const normalized = normalizeSelfServiceProfile({ fullName, phone });
    if (!normalized.success) {
      setMessage({ type: "error", text: normalized.error });
      return;
    }
    setSaving(true);
    setMessage(null);

    try {
      const { error } = await supabase
        .from("users")
        .update({
          full_name: normalized.data.fullName,
          phone: normalized.data.phone,
        })
        .eq("id", profile.id);

      if (error) {
        logIdentityReadFailure("profile-page/update", error);
        setMessage({ type: "error", text: PROFILE_UPDATE_ERROR_MESSAGE });
        return;
      }
      setProfile({
        ...profile,
        full_name: normalized.data.fullName,
        phone: normalized.data.phone,
      });
      setFullName(normalized.data.fullName);
      setPhone(normalized.data.phone || "");
      setEditing(false);
      setMessage({ type: "success", text: "Profile updated successfully" });
    } catch (error) {
      logIdentityReadFailure("profile-page/update-unexpected", error);
      setMessage({ type: "error", text: PROFILE_UPDATE_ERROR_MESSAGE });
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    setPasswordMessage(null);

    if (!newPassword || newPassword.length < 12) {
      setPasswordMessage({
        type: "error",
        text: "Password must be at least 12 characters",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage({
        type: "error",
        text: "Passwords do not match",
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
          text: PASSWORD_UPDATE_ERROR_MESSAGE,
        });
        return;
      }
      setPasswordMessage({
        type: "success",
        text: "Password updated successfully",
      });
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      logIdentityReadFailure("profile-page/password-unexpected", error);
      setPasswordMessage({
        type: "error",
        text: PASSWORD_UPDATE_ERROR_MESSAGE,
      });
    } finally {
      setChangingPassword(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4 max-w-2xl">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="h-64 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  if (!profile || loadError) {
    return (
      <div className="p-5 sm:p-8">
        <div className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-5">
          <h1 className="text-lg font-semibold text-red-900">
            Unable to load profile
          </h1>
          <p className="mt-2 text-sm text-red-800">
            {loadError || "Account data is temporarily unavailable."}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void loadProfile()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Try again
            </button>
            <Link
              href="/login"
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-100"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 sm:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your account settings
        </p>
      </div>

      {message && (
        <div
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
        <div className="rounded-xl border border-border p-6">
          <div className="flex items-center gap-6 mb-6">
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
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {profile.full_name}
              </h2>
              <p className="text-sm text-muted-foreground">{profile.email}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between py-3 border-b border-border">
              <div>
                <p className="text-sm font-medium text-foreground">Email</p>
                <p className="text-sm text-muted-foreground">{profile.email}</p>
              </div>
              <span className="text-xs text-muted-foreground">
                Managed by auth provider
              </span>
            </div>

            <div className="flex items-center justify-between py-3 border-b border-border">
              <div>
                <p className="text-sm font-medium text-foreground">Role</p>
                <p className="text-sm text-muted-foreground">
                  {ROLE_LABELS[profile.role] || profile.role}
                </p>
              </div>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  profile.status === "active"
                    ? "bg-green-100 text-green-800"
                    : "bg-gray-100 text-gray-800"
                }`}
              >
                {profile.status}
              </span>
            </div>

            {editing ? (
              <>
                <div>
                  <label htmlFor="profile-full-name" className="block text-sm font-medium text-foreground mb-1">
                    Full Name
                  </label>
                  <input
                    id="profile-full-name"
                    type="text"
                    autoComplete="name"
                    maxLength={200}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
                <div>
                  <label htmlFor="profile-phone" className="block text-sm font-medium text-foreground mb-1">
                    Phone
                  </label>
                  <input
                    id="profile-phone"
                    type="tel"
                    autoComplete="tel"
                    maxLength={50}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 (555) 000-0000"
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                  <button
                    onClick={() => {
                      setEditing(false);
                      setFullName(profile.full_name || "");
                      setPhone(profile.phone || "");
                    }}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between py-3 border-b border-border">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Full Name
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {profile.full_name || "Not set"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between py-3 border-b border-border">
                  <div>
                    <p className="text-sm font-medium text-foreground">Phone</p>
                    <p className="text-sm text-muted-foreground">
                      {profile.phone || "Not set"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setEditing(true)}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Edit Profile
                </button>
              </>
            )}
          </div>
        </div>

        {/* Change Password */}
        <div className="rounded-xl border border-border p-6">
          <h2 className="text-base font-semibold text-foreground mb-4">
            Change Password
          </h2>

          {passwordMessage && (
            <div
              className={`mb-4 rounded-lg px-4 py-3 text-sm ${
                passwordMessage.type === "success"
                  ? "bg-green-50 text-green-800 border border-green-200"
                  : "bg-red-50 text-red-800 border border-red-200"
              }`}
            >
              {passwordMessage.text}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="profile-new-password" className="block text-sm font-medium text-foreground mb-1">
                New Password
              </label>
              <input
                id="profile-new-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 12 characters"
                className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <div>
              <label htmlFor="profile-confirm-password" className="block text-sm font-medium text-foreground mb-1">
                Confirm New Password
              </label>
              <input
                id="profile-confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <button
              onClick={handleChangePassword}
              disabled={changingPassword}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {changingPassword ? "Updating..." : "Update Password"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
