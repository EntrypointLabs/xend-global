// Soft shadow that lifts a card off the page. iOS reads the shadow* props and
// Android only `elevation`, so this is a style object and not a class.
export const RAISED = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.09,
  shadowRadius: 14,
  elevation: 3,
};
