// `sensitive` hides the picture from other users (the owner and admins still see it), in both
// the public presenter and the picture route.
// `highValue` is not read by any code yet: it is kept for the handover rules planned for
// expensive items.
export const CATEGORIES = Object.freeze({
  phone: { label: 'Phone', highValue: true },
  laptop_tablet: { label: 'Laptop or tablet', highValue: true },
  earbuds_headphones: { label: 'AirPods, earbuds, headphones' },
  charger_cable: { label: 'Charger or cable' },
  book_notebook: { label: 'Book or notebook' },
  student_card_id: { label: 'Student card or ID', sensitive: true },
  wallet_bag: { label: 'Wallet or bag' },
  keys: { label: 'Keys' },
  calculator_stationery: { label: 'Calculator or stationery' },
  usb_storage: { label: 'USB drive or external disk' },
  glasses: { label: 'Glasses' },
  clothing: { label: 'Clothing' },
  water_bottle_lunchbox: { label: 'Bottle or lunch box' },
  other: { label: 'Other' },
});

export const CATEGORY_KEYS = Object.freeze(Object.keys(CATEGORIES));
