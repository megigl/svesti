// ============================================================
//  НАСТРОЙКИ – тук попълвате само Application (client) ID
//  от регистрацията в Microsoft Entra (вижте README.md, Част 3).
// ============================================================
export const CONFIG = {
  // Поставете вашия Application (client) ID между кавичките:
  clientId: "ПОСТАВЕТЕ-ТУК-CLIENT-ID",

  // "consumers" = само лични Microsoft акаунти (Outlook, Hotmail, Live).
  // Ако при регистрацията изберете и служебни акаунти, сменете с "common".
  authority: "https://login.microsoftonline.com/consumers",

  // Единственото разрешение: достъп само до папката на приложението в OneDrive.
  scopes: ["Files.ReadWrite.AppFolder"],

  // Размер на снимките при компресиране (дълга страна в пиксели) и качество.
  photoMaxSide: 1600,
  photoQuality: 0.8,
  thumbMaxSide: 480,
};

// Адресът на приложението (напр. https://ime.github.io/svesti/).
// Същият адрес трябва да е записан като Redirect URI (SPA) в Microsoft Entra.
export const REDIRECT_URI = new URL("./", window.location.href).href.split("#")[0].split("?")[0];
