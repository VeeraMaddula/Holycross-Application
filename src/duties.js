// Bar Staff duty checklist — content taken directly from the printed
// "Bar Duties" sheet, split into its 4 natural sections (Opening, After
// Breakfast, After Carvery, Closing). Purely static reference data; the
// day-to-day tick/untick state lives in db.json (see models.js duty
// functions), keyed by each task's stable `id` below so re-ordering or
// lightly editing task text later won't orphan anyone's ticks for today.
const DUTY_SECTIONS = [
  {
    key: 'opening',
    title: 'Opening Duties',
    tasks: [
      { id: 'opening-1', text: 'Turn on lights' },
      { id: 'opening-2', text: 'Turn on heating' },
      { id: 'opening-3', text: 'Turn on dishwashers' },
      { id: 'opening-4', text: 'Turn on tap lights' },
      { id: 'opening-5', text: 'Fill/check ice' },
      { id: 'opening-6', text: 'Prep lemons' },
      { id: 'opening-7', text: 'Turn on toaster' },
      { id: 'opening-8', text: 'Turn on coffee machines' },
      { id: 'opening-9', text: 'Check milk' },
      { id: 'opening-10', text: 'Set out cutlery' },
      { id: 'opening-11', text: 'Check butter, jam and bread' },
      { id: 'opening-12', text: 'Open blinds' },
      { id: 'opening-13', text: 'Check card machine / hand-held ordering machine are charged' },
      { id: 'opening-14', text: 'Put breakfast menus on the door table' },
      { id: 'opening-15', text: 'Open doors at 9 AM' },
      { id: 'opening-16', text: 'Put display board outside at 9 AM' },
      { id: 'opening-17', text: 'Thursday: put out new black mat from INTEL CLEANING' },
      { id: 'opening-18', text: 'Get the towels from the washing machine and dry them' }
    ]
  },
  {
    key: 'after_breakfast',
    title: 'After Breakfast Duties',
    tasks: [
      { id: 'breakfast-1', text: 'Turn off toaster' },
      { id: 'breakfast-2', text: 'Fill butter and jams' },
      { id: 'breakfast-3', text: 'Clean cups and bread trays' },
      { id: 'breakfast-4', text: 'Open carvery rope at 12 PM' },
      { id: 'breakfast-5', text: 'Put carvery menu on the board' },
      { id: 'breakfast-6', text: 'Check till items match the menu and tell the manager of any gaps' }
    ]
  },
  {
    key: 'after_carvery',
    title: 'After Carvery Duties',
    tasks: [
      { id: 'carvery-1', text: 'Close carvery rope at 3 PM' },
      { id: 'carvery-2', text: 'Get specials from the kitchen' },
      { id: 'carvery-3', text: 'Put Bar & kids menus on the door table' },
      { id: 'carvery-4', text: "Confirm Fish of the Day, Pasta of the Week, Roast of the Week and any 86'd items with the kitchen" },
      { id: 'carvery-5', text: 'Start taking orders around 3:20–3:30 PM once kitchen is ready' },
      { id: 'carvery-6', text: 'Handle deliveries/stock with a senior staff member covering the till' },
      { id: 'carvery-7', text: 'Clean and wrap cutlery when free' }
    ]
  },
  {
    key: 'closing',
    title: 'Closing Duties',
    tasks: [
      { id: 'closing-1', text: 'Clean tables' },
      { id: 'closing-2', text: 'Check sugars and condiments' },
      { id: 'closing-3', text: 'Sweep/hoover mats' },
      { id: 'closing-4', text: 'Stock the fridge' },
      { id: 'closing-5', text: 'Clean milk containers and coffee machine' },
      { id: 'closing-6', text: 'Fill tea bags, coffee biscuits and coffee beans' },
      { id: 'closing-7', text: 'Empty automatic-machine milk' },
      { id: 'closing-8', text: 'Clean bathrooms and refill towels/toilet paper' },
      { id: 'closing-9', text: 'Close blinds and doors' },
      { id: 'closing-10', text: 'Empty glass bottle bins' },
      { id: 'closing-11', text: 'Thursday night: put out green/black/food bins' },
      { id: 'closing-12', text: 'Wednesday night: put out glass bins' },
      { id: 'closing-13', text: 'Clean bar drip trays and the bar' },
      { id: 'closing-14', text: 'Empty ice buckets' },
      { id: 'closing-15', text: 'Turn off tap and small-fridge lights' },
      { id: 'closing-16', text: 'Prep breakfast cutlery tray plus dessert/soup spoons' },
      { id: 'closing-17', text: 'Empty booth-side bins' },
      { id: 'closing-18', text: 'Clean the lemon slice container' },
      { id: 'closing-19', text: 'Staple card receipts' },
      { id: 'closing-20', text: 'Turn off heating' },
      { id: 'closing-21', text: 'Close backside doors and turn off the ice machine' },
      { id: 'closing-22', text: 'Turn off outside lights and the fireside light' },
      { id: 'closing-23', text: 'Do a stock check' },
      { id: 'closing-24', text: 'Mop' },
      { id: 'closing-25', text: 'Turn off the boiler' },
      { id: 'closing-26', text: "Prep next day's bread baskets with jam and butter" },
      { id: 'closing-27', text: 'Close the till and put card receipts in the big safe' },
      { id: 'closing-28', text: 'Turn off music' },
      { id: 'closing-29', text: 'Flag any low stock to a senior staff member or co-worker' },
      { id: 'closing-30', text: 'Turn off and clean the dishwashers' },
      { id: 'closing-31', text: 'Monday night: put out the blue cardboard bin' },
      { id: 'closing-32', text: 'Close doors and set the alarm' },
      { id: 'closing-33', text: 'Wash all the dirty towels before you go' }
    ]
  }
];

const TASK_COUNT = DUTY_SECTIONS.reduce((sum, s) => sum + s.tasks.length, 0);

// Who gets emailed when a duties window closes with something not ticked
// off (or a Bar Staff member explains a miss via the kiosk's Submit
// button) — General Manager, Senior Manager, and Floor Manager specifically,
// not the wider MANAGER_ROLES list (no Admin, no Staff Manager).
const DUTY_ESCALATION_ROLES = ['general_manager', 'senior_manager', 'floor_manager'];

module.exports = { DUTY_SECTIONS, TASK_COUNT, DUTY_ESCALATION_ROLES };
