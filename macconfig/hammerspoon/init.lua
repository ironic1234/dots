-- Simulate left click on Option+Space
local optionSpace = hs.hotkey.new({ "alt" }, "space", function()
	local pos = hs.mouse.getAbsolutePosition()
	hs.eventtap.event.newMouseEvent(hs.eventtap.event.types.leftMouseDown, pos):post()
	hs.timer.usleep(10000) -- slight delay
	hs.eventtap.event.newMouseEvent(hs.eventtap.event.types.leftMouseUp, pos):post()
end)

-- Enable the hotkey
optionSpace:enable()
