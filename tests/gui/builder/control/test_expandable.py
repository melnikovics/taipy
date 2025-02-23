# Copyright 2021-2025 Avaiga Private Limited
#
# Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with
# the License. You may obtain a copy of the License at
#
#        http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
# an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
# specific language governing permissions and limitations under the License.

import taipy.gui.builder as tgb
from taipy.gui import Gui


def test_expandable_builder_1(gui: Gui, helpers):
    with tgb.expandable(title="Expandable section", expanded=False) as content:  # type: ignore[attr-defined]
        tgb.text(value="This is an expandable section")  # type: ignore[attr-defined]
    expected_list = [
        "<Expandable",
        "expanded={false}",
        'title="Expandable section"',
        "This is an expandable section",
    ]
    helpers.test_control_builder(gui, tgb.Page(content, frame=None), expected_list)
