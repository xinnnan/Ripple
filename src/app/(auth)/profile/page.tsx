"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";
import type { UserRole } from "@/types/ticket";
import { ROLE_LABELS } from "@/lib/roles";

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
  const supabase = createClient();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadProfile() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("users")
      .select("id, email, full_name, role, phone, avatar_url, status")
      .eq("id", user.id)
      .single();

    if (data) {
      setProfile(data as UserProfile);
      setFullName(data.full_name || "");
      setPhone(data.phone || "");
    }
    setLoading(false);
  }

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    setMessage(null);

    const { error } = await supabase
      .from("users")
      .update({ full_name: fullName, phone })
      .eq("id", profile.id);

    if (error) {
      setMessage({ type: "error", text: error.message });
    } else {
      setProfile({ ...profile, full_name: fullName, phone });
      setEditing(false);
      setMessage({ type: "success", text: "Profile updated successfully" });
    }
    setSaving(false);
  }

  async function handleChangePassword() {
    setPasswordMessage(null);

    if (!newPassword || newPassword.length < 6) {
      setPasswordMessage({
        type: "error",
        text: "Password must be at least 6 characters",
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

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      setPasswordMessage({ type: "error", text: error.message });
    } else {
      setPasswordMessage({
        type: "success",
        text: "Password updated successfully",
      });
      setNewPassword("");
      setConfirmPassword("");
    }
    setChangingPassword(false);
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

  if (!profile) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">
          Unable to load profile. Please try again.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8">
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
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
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
              <label className="block text-sm font-medium text-foreground mb-1">
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Confirm New Password
              </label>
              <input
                type="password"
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
