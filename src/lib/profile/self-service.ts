export const PROFILE_UPDATE_ERROR_MESSAGE =
  "Unable to update your profile. Please try again.";
export const PASSWORD_UPDATE_ERROR_MESSAGE =
  "Unable to update your password. Please try again.";

export type SelfServiceProfileInput = {
  fullName: string;
  phone: string;
};

export type NormalizedSelfServiceProfile = {
  fullName: string;
  phone: string | null;
};

function containsControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

export function normalizeSelfServiceProfile(
  input: SelfServiceProfileInput
):
  | { success: true; data: NormalizedSelfServiceProfile }
  | { success: false; error: string } {
  const fullName = input.fullName.trim();
  const phone = input.phone.trim();

  if (!fullName) {
    return { success: false, error: "Full name is required." };
  }
  if (fullName.length > 200) {
    return {
      success: false,
      error: "Full name must be 200 characters or fewer.",
    };
  }
  if (containsControlCharacters(fullName)) {
    return { success: false, error: "Full name contains invalid characters." };
  }
  if (phone.length > 50) {
    return {
      success: false,
      error: "Phone must be 50 characters or fewer.",
    };
  }
  if (containsControlCharacters(phone)) {
    return { success: false, error: "Phone contains invalid characters." };
  }

  return {
    success: true,
    data: { fullName, phone: phone || null },
  };
}
